//! 设备身份与设备维度的**启动接线**（桌面侧）。
//!
//! 身份本身的落盘读写与进程级缓存在 `services::identity`（跨平台，因为计时事件流两端
//! 都要写 `device_id`）。这一层只做桌面启动时才需要的事：
//!
//! 1. [`ensure_self`]：在活动库 `devices` 表里把本机标成 `is_self = 1` 并刷新 `last_seen_ms`；
//! 2. [`startup_identity`] / [`startup_business_identity`]：两条启动路径的接线
//!    （活动库在 `sqlite_pool::prepare_pool_schema`，业务库在 `app::bootstrap`）。
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

/// 在 `devices` 里保证「本机」这一行存在且唯一。
///
/// `uq_devices_self` 是 `(is_self) WHERE is_self = 1` 的唯一索引，所以先把别的行降级
/// （只可能发生在「用户手工改过库」或「身份文件被换掉」之后），再 upsert 自己。
/// `label` 留空由前端按需填：空 label 显示成 `install_id` 前 6 位，比强行写
/// 一个「Windows PC」更不容易误导（一个人可能有三台 Windows）。
pub async fn ensure_self(pool: &Pool<Sqlite>, install_id: &str) -> Result<(), String> {
    if !crate::services::identity::is_valid(install_id) {
        return Err(format!("invalid install id `{install_id}`"));
    }
    let now_ms = crate::infra::activity::clock::unix_timestamp_millis_i64();
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

/// 启动身份接线（`prepare_pool_schema` 在迁移之后调它）：取身份 → 登记缓存 → 认领哨兵行 → 标记本机。
///
/// 「登记缓存」这一步不能省：`identity::install_id()` 是计时事件流唯一的取值来源，
/// 它填不上就等于所有事件都没有 `device_id`（→ uid 恒 NULL → 永不同步，且零报错）。
pub async fn startup_identity(pool: &Pool<Sqlite>) -> Result<String, String> {
    /* 以缓存里的那一份为准：认领历史行与新写入的行必须是同一个 `device_id`，
    否则同一台机器会出现两个设备（见 `identity::remember_and_lock_install_id`）。 */
    let install_id = crate::services::identity::remember_and_lock_install_id(
        crate::services::identity::load_install_id()?,
    );
    let adopted =
        crate::services::activity::schema_core::adopt_local_rows(pool, &install_id).await?;
    if adopted > 0 {
        crate::log_info!("adopted {adopted} local activity row(s) into device {install_id}");
    }
    ensure_self(pool, &install_id).await?;
    Ok(install_id)
}

/// 业务库（`timing.db`）的身份接线：把四张带 uid 语义的表（`items` / `time_records` /
/// `item_app` / `timer_ops`，清单见 `schema_core::ensure` 的 `BUSINESS_UID_ADOPTIONS`）里
/// `device_id = ''` 的行认领到本机，并让库补出 `uid`。
///
/// 与 [`startup_identity`] 分开是因为两个库走两个池、两条初始化路径（业务库在
/// `app::bootstrap`，活动库在 `sqlite_pool::prepare_pool_schema`）。身份本身是同一份：
/// 同一台机器两个库共用一个 `install_id.txt`，否则 `time_records.uid` 与
/// `sessions.uid` 会在 P4 同步成两条互不相干的设备。
///
/// ⚠️ 必须在 `infra::db::init_pool`（迁移）之后调：列是迁移加的。调用点放在
/// `app::bootstrap` 而不是 `infra` 层，因为 `check-layers` 的 L4 不许 `infra` 依赖 `services`。
pub async fn startup_business_identity(pool: &Pool<Sqlite>) -> Result<String, String> {
    /* 同 [`startup_identity`]：认领时用的 `device_id` 必须与缓存一致，否则被认领的历史行
    与之后新建的行会落在两台「设备」上。 */
    let install_id = crate::services::identity::remember_and_lock_install_id(
        crate::services::identity::load_install_id()?,
    );
    let adopted =
        crate::services::activity::schema_core::adopt_business_rows(pool, &install_id).await?;
    if adopted > 0 {
        crate::log_info!("adopted {adopted} local business row(s) into device {install_id}");
    }
    Ok(install_id)
}

/* 判据（认领哨兵行 / 发 uid / 四张表全覆盖）在 `device_tests.rs`：正文贴着 300 行门禁。 */
