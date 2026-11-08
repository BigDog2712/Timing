//! 手机端一轮同步的编排。
//!
//! ## [V0.11.22] 只剩云端一条路
//!
//! v0.11.21 之前这里是三段式：云端可用 → 云端那一轮；否则 SAF 三步
//! （`mirrorIn` → Rust 合并 → `mirrorOut`）。主人这一轮把后者下线了
//! （原话：「手机端无法使用云端的本地同步，此功能去除，仅保留云端同步」），
//! 所以现在的入口判定只有两条：
//!
//! ```text
//! ① config::load（+ 一行配置日志，仍是手机上唯一的「用户配了什么」现场）
//! ② 云端可用（enabled && is_usable）→ md_cloud::round，返回它的报告
//! ③ 否则 → 明确报错，让用户去填云端
//! ```
//!
//! ③ 不再回落 SAF：回落会让「云端填了一半」表现为「同步成功但没传上去」，
//! 而 SAF 那条路的落点在手机上已经没有入口可配，回落过去只会拿到「未授权」。
//!
//! 留下的两个原生能力：
//! - `saf_status`：`md_saf_status` 命令还在契约面上，界面虽然不再调用它，命令要能自报状态；
//! - `open_file`：「在 Obsidian 里打开今天那份」（`md_sync_open`）。
//!
//! 原 SAF 三步的编排与 `mirror_root()` 已删除。`services::md_sync::mirror` 本身保留——
//! 它是纯服务层（可单测），删掉会连带改 `md_saf_*` 两条命令与既有用例，
//! 与本轮要解决的问题无关。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::infra::native_bridge::NativeBridge;
use crate::models::md_sync::MdSyncReport;
use crate::models::native::SafStatus;
use crate::state::AppState;

fn bridge(app: &AppHandle) -> AppResult<tauri::State<'_, NativeBridge<tauri::Wry>>> {
    app.try_state::<NativeBridge<tauri::Wry>>()
        .ok_or_else(|| AppError::io("原生桥未注册：TimingNativePlugin 没有加载"))
}

/// 当前 SAF 授权状态。
///
/// [V0.11.22] 界面已无入口，但 `md_saf_status` 命令仍在契约面上（78 条之一），
/// 这条能力必须还能回答「授权还在不在」——排查「为什么手机不同步了」时它是第一句话。
pub async fn saf_status(app: &AppHandle) -> AppResult<SafStatus> {
    bridge(app)?
        .call("safStatus", serde_json::json!({}))
        .await
}

/// 用系统里装着的那款编辑器打开指定文件（通常是 Obsidian）。
///
/// 手机上「打开文件」不是应用内预览：vault 在共享存储里，交给 `ACTION_VIEW`
/// 让用户自己装的编辑器接管。
pub async fn open_file(app: &AppHandle, rel: &str) -> AppResult<()> {
    bridge(app)?
        .call::<serde_json::Value>("safOpen", serde_json::json!({ "rel": rel }))
        .await
        .map(|_| ())
}

/// 跑一轮完整同步：**只有云端那一轮**（见文件头 §① ② ③）。
///
/// 云端不可用时给的是 `MD_SYNC_CONFIG_INVALID` + 能照做的一句话，不是 `IO_ERROR`：
/// 「没填完」是配置问题，润色成「系统调用失败」只会让人反复点。
pub async fn sync_once(app: &AppHandle) -> AppResult<MdSyncReport> {
    let pool = app.state::<AppState>().pool.clone();

    /* ① 配置。这一行日志是手机上唯一的「用户到底配了什么」现场：
    `enabled` 与云端开关同值（前端一次写两处），三个绑定仍是云端那轮的写入口。 */
    let config = crate::services::md_sync::config::load(&pool).await?;
    crate::log_info!(
        "md sync config: enabled={} cloud={} bindings=[{}]",
        config.enabled,
        match config.cloud.as_ref() {
            Some(cloud) => format!(
                "enabled={} mode={:?} usable={}",
                cloud.enabled,
                cloud.mode,
                cloud.is_usable()
            ),
            None => "<无>".to_string(),
        },
        config
            .bindings
            .iter()
            .map(|b| format!(
                "{}:enabled={},file={},heading={}",
                b.kind.label(),
                b.enabled,
                if b.file.trim().is_empty() { "<空>" } else { b.file.trim() },
                if b.heading.trim().is_empty() { "<空>" } else { b.heading.trim() }
            ))
            .collect::<Vec<_>>()
            .join(" | ")
    );

    /* ② 云端通道：直接交回云端那轮的完整报告，**不叠加**任何本地计数。 */
    if crate::services::md_cloud::usable(&config).is_some() {
        let outcome = crate::services::md_cloud::round(&pool).await?;
        return Ok(outcome.report);
    }

    /* ③ 没有云端 = 没有落点。措辞里必须带「云端」二字：用户照着这句话就知道去哪一页。 */
    Err(AppError::md_sync_config_invalid(
        "手机端只同步云端：先在「设置 → 数据管理」里填好服务地址、账号和应用密码，再点保存",
    ))
}
