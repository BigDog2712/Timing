//! Patina 子系统的宿主侧接线：数据落点 + 首启导入。
//!
//! 为什么单独一个文件：`bootstrap.rs` 正好 300 行（门禁上限），而这段逻辑
//! 又不属于「Patina 上游代码」，放在 `src/patina/` 下会让 vendored 子树与宿主耦合。
//!
//! 两件事，顺序不能换（由 `lib.rs` 的 setup 闭包保证）：
//! 1. **定落点**：Patina 上游按 `%APPDATA%\Patina` 解析数据根——那正是用户已安装的
//!    Patina 的真实目录。融合后必须改到 Timing 自己的根下，否则两个应用同时打开
//!    同一个 sqlite 文件（WAL 抢锁 → 锁超时 / 库损坏）。
//! 2. **首启导入**：目标库不存在时，从 `%APPDATA%\Patina\patina.db` 拷一份过来，
//!    让「已用过 Patina」的用户一进来就看到自己的历史。之后两边各管各的，
//!    同不同步是后续功能，不在这里做。

use std::path::{Path, PathBuf};

/// Patina 子系统在 Timing 数据根下的落点：`<数据根>/patina/{data,webview}`。
pub fn patina_root() -> PathBuf {
    crate::platform::app_dir::data_root().join("patina")
}

/// 上游（独立安装的 Patina）的数据目录。
///
/// 直接用 `dirs` 求 `%APPDATA%`：这里要**故意**绕开 Tauri 的 `app_data_dir()`
/// （那是 Timing 自己的标识符目录），也绕开 Patina 的 profile 逻辑——
/// 我们只要「用户装过的那一份」，认不到就当没有。
fn upstream_data_dir() -> Option<PathBuf> {
    let roaming = dirs::data_dir()?;
    let candidate = roaming.join("Patina");
    candidate.is_dir().then_some(candidate)
}

/// 启动期一次性准备。返回 `Ok(None)` = 本次没导入（不需要 / 没有源）。
///
/// 失败**不阻断启动**：Patina 子系统照常跑，只是历史为空——比整个应用起不来好。
pub fn prepare() -> Result<Option<PathBuf>, String> {
    let root = patina_root();
    let data_dir = root.join("data");
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("创建 {} 失败: {err}", data_dir.display()))?;

    // 落点在创建之后立刻注入：Patina 的 setup 会拿它建库，晚一步就落到 AppData 去了。
    crate::patina::platform::app_paths::set_root_override(root.clone());

    let target = data_dir.join("patina.db");
    if target.exists() {
        return Ok(None);
    }
    let Some(source_dir) = upstream_data_dir() else {
        return Ok(None);
    };
    let source = source_dir.join("patina.db");
    if !source.is_file() {
        return Ok(None);
    }

    copy_database(&source, &target)?;
    crate::log_info!(
        "patina: imported existing data {} -> {}",
        source.display(),
        target.display()
    );
    Ok(Some(target))
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
