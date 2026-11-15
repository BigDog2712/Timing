//! Patina 首启导入：从**独立安装**的那一份 `%APPDATA%\Patina\patina.db` 拷一次历史。
//!
//! 为什么单独一个文件：`activity_bridge.rs` 管的是「落点 + 读侧」，而这段是一次性的**写**
//! 动作，还带着自己的一条状态（「已处理过」标记）。两种寿命尺度混在一个文件里，后来的人
//! 很容易以为导入每次启动都在跑。
//!
//! ## 三道闸，缺一不可
//!
//! | 顺序 | 判据 | 挡的是什么 |
//! |---|---|---|
//! | ① | 数据根存在指针（`%APPDATA%\Patina` 无关；指针 = `%APPDATA%\<identifier>\data-root.json`） | 这个根是用户**显式选定**的，不是「第一次用 Timing」 |
//! | ② | 标记 `patina/data/.patina-import-done` 在 | 搬完以后新位置没有活动库的那个洞 |
//! | ③ | 目标库 `patina/data/patina.db` 已存在 | 兜底：已装用户升级上来时标记可能还没有 |
//!
//! **③ 是原来就有的那道闸，保留不动**；①② 是后来加在它前面的，不是替换它。三道的
//! 关系是「前面的先否掉、后面的再兜底」，删掉任何一道都会重新打开一个已知洞。
//!
//! 为什么要有 ①：指针在 = 这个数据根是用户显式选的，它没有活动库只说明「这个位置还
//! 没放过活动数据」，不代表「用户是第一次用 Timing」。而 `%APPDATA%\Patina` 是**另一个
//! 产品**的数据目录，那份历史属于「用户独立装的 Patina」，不属于当前这个数据根。
//! 两种坏结果里，**空活动库是诚实的**（用户知道这个位置还没有活动数据），**灌入另一份
//! 数据集是撒谎**（用户不知道自己的历史被换掉了）。
//!
//! 为什么要有 ②：搬迁（`services::data_root`）会把活动库送到新位置，但用户从来没在这个
//! 根里留下过活动库时，新位置自然也没有它——此刻「目标不存在」与「第一次启动」长得一
//! 模一样，于是又从上游导一次，用户看到的活动历史突然变成另一份数据集，零报错。标记放在
//! `patina/data/` 里而**不是** `patina/` 根下：搬迁只搬 `patina/data`（六项清单里
//! `webview` 是运行中的缓存不搬），标记必须跟着被搬的那份数据走，否则搬完之后新位置
//! 没有标记，等于把首启导入重新武装一遍。
//!
//! ## 什么时候写标记
//!
//! 只走完 ②③ 的**一次判断**之后：目标已存在 / 没有源 / 真的拷了一份。`copy_database`
//! 失败是真的失败（不是「已经处理过」），返回 `Err` 且**不写**标记，下次启动重试。
//! ①把闸拉下时连标记都不写：用户哪天把数据根挪回默认位置，首启导入应该还能正常工作。

use crate::infra::activity::{app_paths, storage_paths};
use std::path::{Path, PathBuf};

/// 「首启导入已处理」标记的文件名（落在 `patina/data/` 里）。
pub(crate) const IMPORT_MARKER: &str = ".patina-import-done";

/// 生产入口：`appdata` 是 `%APPDATA%\<identifier>`（指针文件所在目录），
/// 源是用户可能装过的独立 Patina。
pub(crate) fn seed(data_dir: &Path, appdata: Option<&Path>) -> Result<Option<PathBuf>, String> {
    seed_from(data_dir, appdata, upstream_database().as_deref())
}

/// 可测入口：`appdata` 与 `source` 都由调用方给（生产分别是 `%APPDATA%\<identifier>`
/// 与 `%APPDATA%\Patina\patina.db`）。
///
/// 分成两个函数而不是给 `seed` 加参数：`upstream_database()` 读的是真实 `%APPDATA%`，
/// 用例若拿不到注入点就只剩「什么都不发生」可断——那正是这条路径出问题时最没用的断言。
pub(crate) fn seed_from(
    data_dir: &Path,
    appdata: Option<&Path>,
    source: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    /* 闸①：指针在 → 一律不导。理由见文件头那三句；这里只说结果——数据根是用户挑的，
    它没有活动库就让它空着。 */
    if appdata.and_then(crate::infra::root_pointer::read).is_some() {
        return Ok(None);
    }
    /* 闸②：标记在 → 这个根已经处理过，什么都不做。 */
    let marker = data_dir.join(IMPORT_MARKER);
    if marker.exists() {
        return Ok(None);
    }
    /* 闸③：目标库在 → 这个根里本来就有历史，不需要也不该被另一份覆盖（兜底，保留）。

       这里**必须**引 `SQLITE_DB_FILE_NAME` 而不是写 `"patina.db"`：闸③ 的判断与下面
       `write_marker` 是无条件的一对——库名翻新而这里仍是旧名时，干净的自定义根会被判
       「该导」，上游历史被拷成旧名文件，标记照写，随后按新名读不到库 ⇒ 建空库，
       而下次启动闸② 见标记在就直接返回 ⇒ **这次导入永久作废、用户侧不可自愈**。 */
    let target = data_dir.join(storage_paths::SQLITE_DB_FILE_NAME);
    let imported = match source {
        Some(from) if !target.exists() => {
            copy_database(from, &target)?;
            crate::log_info!(
                "patina: imported existing data {} -> {}",
                from.display(),
                target.display()
            );
            Some(target)
        }
        _ => None,
    };
    write_marker(&marker);
    Ok(imported)
}

/// 独立安装的 Patina 的库文件（认不到就当没有）。
///
/// 两个值走 `app_paths::UPSTREAM_*`，与 `PRODUCT_FOLDER` / `SQLITE_DB_FILE_NAME` **分成
/// 两套常量**：这里读的是**别人**的数据目录，永远不变；我们自己那两只会被 T05 改掉。
/// 合并成一套的话，T05 之后首启导入会去 `%APPDATA%\Activity` 里找，那里什么都没有 ——
/// 导入静默失效，且标记照写。
fn upstream_database() -> Option<PathBuf> {
    let candidate = dirs::data_dir()?
        .join(app_paths::UPSTREAM_PRODUCT_FOLDER)
        .join(app_paths::UPSTREAM_DB_FILE);
    candidate.is_file().then_some(candidate)
}

/// 写标记。写不进去只记日志：下次启动会再判一次，代价是多探一次 `%APPDATA%`。
fn write_marker(path: &Path) {
    if let Err(err) = std::fs::write(path, b"imported\n") {
        crate::log_warn!("patina: 写导入标记失败 {}: {err}", path.display());
    }
}

/// 拷一份 sqlite 库。
///
/// 用 `VACUUM INTO` 而不是文件复制：源库可能正在被独立安装的 Patina 写（WAL 里还有
/// 未落盘的页），直拷 `.db` 会拿到撕裂状态。`VACUUM INTO` 走 sqlite 的一致性读事务，
/// 不需要源库可写。
fn copy_database(source: &Path, target: &Path) -> Result<(), String> {
    let escaped_source = sqlite_url(source)?;
    let escaped_target = target.display().to_string().replace('\'', "''");

    let result = tauri::async_runtime::block_on(async move {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;

        let options = SqliteConnectOptions::from_str(&escaped_source)
            .map_err(|err| format!("解析源库地址失败: {err}"))?
            /* sqlx 0.8 默认就是 `false`（文件不存在 → 打开失败而不是建空库），这里显式
            写出来是给下一个读代码的人看的：**不许**因为源文件刚在 TOCTOU 窗口里消失，
            就静默地拿一份空库去 `VACUUM INTO`。 */
            .create_if_missing(false)
            .read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|err| format!("打开源库失败: {err}"))?;
        let outcome = sqlx::query(&format!("VACUUM INTO '{escaped_target}'"))
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|err| format!("VACUUM INTO 失败: {err}"));
        pool.close().await;
        outcome
    });

    if let Err(err) = result {
        /* 退路：源库被独占锁住时 `VACUUM INTO` 会失败，此时至少把主库文件搬过去。
        一致性没有保证，所以只在 VACUUM 失败后尝试，并在日志里明说。 */
        crate::log_warn!("patina: VACUUM INTO failed ({err}); falling back to file copy");
        std::fs::copy(source, target)
            .map_err(|copy_err| format!("{err}; 且文件复制也失败: {copy_err}"))?;
    }
    Ok(())
}

/// `sqlite://<绝对路径>?mode=ro`。Windows 的反斜杠在 URL 里会被当转义，统一换正斜杠。
fn sqlite_url(path: &Path) -> Result<String, String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    Ok(format!("sqlite://{normalized}?mode=ro"))
}
