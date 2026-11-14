//! 设备身份与设备维度的**启动接线**（桌面侧）。
//!
//! 这一层只做三件事，真正的逻辑在 `services::insight::schema_core`（可移植内核）：
//!
//! 1. [`config_dir`]：本机配置目录（`%APPDATA%\com.timing.app\`），`install_id.txt` 住这；
//! 2. [`ensure_install_id`]：读/生成 12 位身份；
//! 3. [`ensure_self`]：在 `devices` 表里把本机标成 `is_self = 1` 并刷新 `last_seen_ms`。
//!
//! ## 为什么 install_id 不放数据根里
//!
//! 数据根可以被用户改（`data-root.json`）、可以整目录拷到另一台机器。身份一旦跟着数据
//! 根走，「同一台机器换个数据根」就成了新设备，而「拷过去的库」又带着别人的身份。
//! 放配置目录 = 跟着**这台机器**走，与数据根无关（设计 §6.1 的「唯一落盘位置」）。
//!
//! ## 桌面与手机各自一份
//!
//! 手机是另一个操作系统、另一个沙箱（`/data/user/0/com.timing.app/`），天然就是另一份
//! 文件、另一个 install_id。同一个人两台设备 = 两个 device_id，这正是同步要的语义。

use sqlx::{Pool, Sqlite};
use std::path::PathBuf;

/// 本机平台标识。取值必须落在 `devices.platform` 的 `CHECK` 列表里。
pub const fn host_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "linux"
    }
}

/// 本机配置目录：`%APPDATA%\com.timing.app`（Windows）/ 等价的 per-user 目录。
///
/// **测试隔离**：`cargo test --lib` 会有几十处经 `prepare_pool_schema` 走到这里。
/// 那些用例的库全是 `:memory:` 或临时文件，绝不能让它们去读写开发机上**真实的**
/// `%APPDATA%\com.timing.app\install_id.txt`——那会在从没跑过 App 的机器上凭空造出一个
/// 身份文件，而且并行用例会互相看见同一个身份。测试二进制改用进程级临时目录。
pub fn config_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    let dir = std::env::temp_dir().join(format!("timing-test-config-{}", std::process::id()));
    #[cfg(not(test))]
    let dir = crate::platform::app_dir::fallback_appdata();

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create config dir `{}`: {error}", dir.display()))?;
    Ok(dir)
}

/// 读/生成本机 `install_id`（12 位小写 hex）。
pub fn ensure_install_id() -> Result<String, String> {
    crate::services::insight::schema_core::ensure_install_id(&config_dir()?)
}

/// 在 `devices` 里保证「本机」这一行存在且唯一。
///
/// `uq_devices_self` 是 `(is_self) WHERE is_self = 1` 的唯一索引，所以先把别的行降级
/// （只可能发生在「用户手工改过库」或「身份文件被换掉」之后），再 upsert 自己。
/// `label` 留空由前端按需填：空 label 显示成 `install_id` 前 6 位，比强行写
/// 一个「Windows PC」更不容易误导（一个人可能有三台 Windows）。
pub async fn ensure_self(pool: &Pool<Sqlite>, install_id: &str) -> Result<(), String> {
    if !crate::services::insight::schema_core::device::is_valid(install_id) {
        return Err(format!("invalid install id `{install_id}`"));
    }
    let now_ms = crate::infra::insight::clock::unix_timestamp_millis_i64();
    sqlx::query("UPDATE devices SET is_self = 0 WHERE is_self = 1 AND install_id <> ?1")
        .bind(install_id)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to demote the previous self device: {error}"))?;
    sqlx::query(
        "INSERT INTO devices(install_id, label, platform, color, is_self, first_seen_ms, last_seen_ms)
         VALUES (?1, '', ?2, '', 1, ?3, ?3)
         ON CONFLICT(install_id) DO UPDATE SET is_self = 1, last_seen_ms = excluded.last_seen_ms",
    )
    .bind(install_id)
    .bind(host_platform())
    .bind(now_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to upsert the self device: {error}"))?;
    Ok(())
}

/// 启动身份接线（`prepare_pool_schema` 在迁移之后调它）：取身份 → 认领哨兵行 → 标记本机。
///
/// 返回本机 `install_id`，调用方（目前没人用）可以拿它做日志或后续投影。
pub async fn startup_identity(pool: &Pool<Sqlite>) -> Result<String, String> {
    let install_id = ensure_install_id()?;
    let adopted = crate::services::insight::schema_core::adopt_local_rows(pool, &install_id).await?;
    if adopted > 0 {
        crate::log_info!("adopted {adopted} local activity row(s) into device {install_id}");
    }
    ensure_self(pool, &install_id).await?;
    Ok(install_id)
}

/// 业务库（`timing.db`）的身份接线：把 `time_records.device_id = ''` 认领到本机并补 `uid`。
///
/// 与 [`startup_identity`] 分开是因为两个库走两个池、两条初始化路径（业务库在
/// `app::bootstrap`，活动库在 `sqlite_pool::prepare_pool_schema`）。身份本身是同一份：
/// 同一台机器两个库共用一个 `install_id.txt`，否则 `time_records.uid` 与
/// `sessions.uid` 会在 P4 同步成两条互不相干的设备。
///
/// ⚠️ 必须在 `infra::db::init_pool`（迁移）之后调：列是迁移加的。调用点放在
/// `app::bootstrap` 而不是 `infra` 层，因为 `check-layers` 的 L4 不许 `infra` 依赖 `services`。
pub async fn startup_business_identity(pool: &Pool<Sqlite>) -> Result<String, String> {
    let install_id = ensure_install_id()?;
    let adopted = crate::services::insight::schema_core::adopt_business_rows(pool, &install_id).await?;
    if adopted > 0 {
        crate::log_info!("adopted {adopted} local time record(s) into device {install_id}");
    }
    Ok(install_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 业务库的认领：哨兵 `''` → 本机，`uid` 由 `t:` 前缀发出，重复跑不改值。
    #[test]
    fn business_identity_adopts_sentinel_rows_and_mints_time_record_uids() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
            crate::infra::migrate::migrate(&pool).await.unwrap();
            sqlx::query(
                "INSERT INTO time_records (item_id, status, started_at, ended_at, created_at, updated_at)
                 VALUES (1, 'saved', 1000, 2000, 1000, 1000)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let install_id = startup_business_identity(&pool).await.unwrap();
            let (device_id, uid): (String, Option<String>) =
                sqlx::query_as("SELECT device_id, uid FROM time_records")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(device_id, install_id);
            assert_eq!(uid.as_deref(), Some(format!("t:{install_id}:1").as_str()));

            // 幂等：第二次启动不改任何值，也不再产生新的 uid。
            startup_business_identity(&pool).await.unwrap();
            let again: (String, Option<String>) =
                sqlx::query_as("SELECT device_id, uid FROM time_records")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!((again.0, again.1), (device_id, uid));
        });
    }
}
