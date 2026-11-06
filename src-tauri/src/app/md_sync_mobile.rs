//! 手机端一轮同步的编排：镜像进 → Rust 合并 → 写回 vault。
//!
//! 放在 `app` 层而不是 `services`：`services` 至今不碰任何 Tauri 类型（能被单测直接
//! 调用），而这一步必须同时用到 `AppHandle`（数据目录）与原生桥。`commands` 与 `jobs`
//! 都调这里，避免两处各写一遍三步流程、慢慢走偏。
//!
//! 三步的理由见 `services::md_sync::mirror`：Android 的落点是 `content://` 树 URI，
//! `std::fs` 不认它，所以只把当天那几个文件搬进沙箱，合并逻辑原样复用桌面那一份。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::infra::native_bridge::NativeBridge;
use crate::models::md_sync::MdSyncReport;
use crate::models::native::{MirrorOutResult, MirrorResult, SafStatus};
use crate::services::md_sync::mirror;
use crate::state::AppState;

/// 与 `commands::md_sync_cmd_mobile` 及 Kotlin 侧 `MIRROR_DIR` 必须一致。
const MIRROR_DIR: &str = "md-mirror";

/// 镜像目录绝对路径，顺便建出来。`app_data_dir` 在 Android 就是应用沙箱
/// （`/data/user/0/com.timing.app`），与 `timing.db` 同级。
fn mirror_root(app: &AppHandle) -> AppResult<String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(AppError::io)?
        .join(MIRROR_DIR);
    std::fs::create_dir_all(&base).map_err(AppError::io)?;
    Ok(base.to_string_lossy().into_owned())
}

fn bridge(app: &AppHandle) -> AppResult<tauri::State<'_, NativeBridge<tauri::Wry>>> {
    app.try_state::<NativeBridge<tauri::Wry>>()
        .ok_or_else(|| AppError::io("原生桥未注册：TimingNativePlugin 没有加载"))
}

/// 当前 SAF 授权状态。
pub async fn saf_status(app: &AppHandle) -> AppResult<SafStatus> {
    bridge(app)?
        .call("safStatus", serde_json::json!({}))
        .await
}

/// 用系统里装着的那款编辑器打开指定文件（通常是 Obsidian）。
///
/// 手机上「打开文件」不是应用内预览：vault 在共享存储里，交给 `ACTION_VIEW`
/// 让用户自己装的编辑器接管，也顺带让「在 Obsidian 里改完 → 回来同步」这条链路顺。
pub async fn open_file(app: &AppHandle, rel: &str) -> AppResult<()> {
    bridge(app)?
        .call::<serde_json::Value>("safOpen", serde_json::json!({ "rel": rel }))
        .await
        .map(|_| ())
}

/// 跑一轮完整同步。落点为空（用户全关了）或没选目录时返回错误，调用方按需展示。
///
/// 两处「先自查再动手」：
/// - 目录授权：`mirrorIn` 里才失败的话，错误会经原生桥折成一句 `IO_ERROR`，用户在设置页
///   看到的只有「系统调用失败」——先问一句 `safStatus`，就能给「去选目录」这种能照做的提示；
/// - 镜像根：**由 Rust 算好绝对路径传给 Kotlin**。两边各自推导（Rust `app_data_dir` vs
///   Kotlin `activity.dataDir`）在 Android 上恰好相同，但那是巧合而不是约定；一旦某个
///   版本拼法变了，表现是「同步永远说没改动」，比报错难查得多。
pub async fn sync_once(app: &AppHandle) -> AppResult<MdSyncReport> {
    let pool = app.state::<AppState>().pool.clone();

    if !saf_status(app).await?.granted {
        /* 措辞里要带「未授权」：`jobs::md_sync_mobile` 靠这个词把「还没配好」和真故障
           分开，配好之前每 15 分钟一条 warn 会把日志淹掉。 */
        return Err(AppError::md_sync_config_invalid(
            "同步目录未授权：点「日记目录 → 选择」给一次授权，程序会记住这个目录",
        ));
    }

    let rels = mirror::mirror_paths(&pool).await?;
    if rels.is_empty() {
        return Err(AppError::md_sync_config_invalid("没有启用任何落点"));
    }

    let root = mirror_root(app)?;
    let native = bridge(app)?;

    /* 1. vault → 镜像。不存在的路径原生侧直接跳过（vault 里还没有今天的日记）。 */
    let pulled: MirrorResult = native
        .call("mirrorIn", serde_json::json!({ "root": &root, "paths": &rels }))
        .await?;

    /* 2. 与桌面同一套合并。 */
    let mut report = mirror::run_in(&pool, &root).await?;

    /* 3. 镜像 → vault。全部路径都交回去，由原生侧按内容差异决定写不写；
       新增文件（今天第一次写日记）也在这一步被创建。 */
    let pushed: MirrorOutResult = native
        .call("mirrorOut", serde_json::json!({ "root": &root, "paths": &rels }))
        .await?;

    /* 单个文件的读写失败不致命，但要并进报告——否则用户只看到「没有需要同步的改动」。 */
    report.errors.extend(pulled.errors);
    report.errors.extend(pushed.errors);
    Ok(report)
}
