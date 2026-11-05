//! 自启接管（桌面独占）：迁移成功后清理旧值名，并按用户原设置重挂。
//!
//! 顺序是**先挂新的、再删旧的**：任何一步失败都不会让用户丢掉自启。
//!
//! 阶段注意：注册表值名 = `productName`（不是 identifier）。阶段一 `productName` 仍是
//! `TickBar`，所以「旧值名」与「当前值名」相同 —— 此时**绝不能**执行删除，否则会把
//! 刚确认过的自启删掉。函数内部用 `package_info().name` 做这个比较，阶段二改了
//! `productName` 之后清理自动生效，无需再改这里。

use tauri::AppHandle;

use crate::infra::appdata_migrate::paths::LEGACY_PRODUCT_NAME;
use crate::infra::appdata_migrate::MigrationOutcome;
use crate::infra::autostart;

/// 只在「本次真的迁移过」时动作：全新用户、已迁移、目标被占用都不碰注册表。
pub fn run(app: &AppHandle, outcome: &MigrationOutcome) -> Result<(), String> {
    if !matches!(outcome, MigrationOutcome::Migrated(_)) {
        return Ok(());
    }

    let current_name = app.package_info().name.clone();
    let legacy_found = autostart::legacy_value_exists(LEGACY_PRODUCT_NAME);
    let mut re_enabled = false;
    let mut removed = false;

    if legacy_found {
        /* 旧版本开过自启 → 新版也要开着。先读当前状态，避免把用户主动关掉的自启又打开。 */
        let enabled_now = autostart::is_enabled(app).unwrap_or(false);
        if !enabled_now {
            re_enabled = autostart::set_enabled(app, true).is_ok();
        }
        /* 只有「旧值名 ≠ 当前值名」时才删：否则删的就是当前正在用的那一条。 */
        if current_name != LEGACY_PRODUCT_NAME {
            removed = autostart::remove_legacy_value(LEGACY_PRODUCT_NAME).unwrap_or(false);
        }
    }

    crate::log_info!(
        "autostart: legacy value found={legacy_found}, re-enabled={re_enabled}, removed={removed}"
    );
    Ok(())
}
