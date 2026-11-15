//! uid 为空的行：**合成**一个确定性 uid，而不是退化成「按 `id` 忽略」。
//!
//! ## 为什么需要这一层
//!
//! 导入的包可能带着整表 `uid` 为空的行：`uid` 由 AFTER INSERT 触发器按 `device_id` 发
//! （`WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''`），而**旧版本**的 `items`
//! 插入点没写 `device_id` ⇒ 那批行 `uid` 全 `NULL`、`device_id` 全空串。
//!
//! 启动认领（`services::device::startup_business_identity` → `adopt_business_rows`，
//! 现已覆盖 `items` / `time_records` / `item_app` / `timer_ops` 四张表，清单是
//! `schema_core/ensure.rs` 里的私有字面量表 `BUSINESS_UID_ADOPTIONS`）只修**本机自己**
//! 的库；而包描述的是**别的设备**在升级前导出的快照，本机的认领够不着它 —— 所以导入侧
//! 仍然必须自己能给空 `uid` 的行补上合并键 —— 否则「用这类包导入」就是一批没有合并键
//! 的行。
//!
//! 老做法（uid 为空 → `INSERT OR IGNORE` + 保留 `id`）有两个后果：
//! · **换机导入会静默丢数据** —— `id` 是本地自增号，包里的 `id=1` 与目标库的种子事项
//!   撞车，`OR IGNORE` 直接把这一行吞掉，事后再无痕迹；
//! · **同一份包导两次不再幂等** —— 键变成「自增 id」，撞了就算，没撞上就多一份。
//!
//! ## 合成规则
//!
//! `<前缀><来源设备>:<包里的原始 id>`，与库里的触发器**逐字同一套格式**
//! （`'i:' || device_id || ':' || id`，见 `migrations/0011_v0142_item_attribution_guard.sql`）。
//! 三个理由：
//! 1. **同一条逻辑行两条路拿同一个值** —— 走「带 uid 插入」和走「触发器发放」必须一致，
//!    否则两台设备各认一半，同步时会变成两行；
//! 2. **确定性** —— 同一个包导多少次都是同一个 uid，幂等回来了；
//! 3. **不会被触发器改写** —— `trg_*_uid` 的条件是 `WHEN NEW.uid IS NULL`，带非空 uid
//!    插入原样落库（这也是整个方案能成立的前提）。
//!
//! `device_id` 一起补成来源设备：空串留在库里的含义是「还没认领」，不该由导入产生；
//! 而且 uid 里已经写着它，两列不同步会自相矛盾（`adopt_business_rows` 恰恰是按
//! `device_id` 判「要不要认领」的）。
//!
//! ## 什么时候**不**合成（继续退化成 `INSERT OR IGNORE`）
//!
//! ① 行里连原始 `id` 都没有 —— 拿不到确定性输入（真实包不会这样：导出是 `SELECT *`）；
//! ② 行里 `device_id` 与包的 `deviceId` 都是空 —— 只剩 `i::12` 这种半截身份，
//!    正是迁移守卫要拦的东西；
//! ③ 表不在前缀表里（`todos` / `notes` / `icon_cache` 本来就没有 uid 语义）。
//!
//! 判据见 `tests::bundle_uid`（③④）与 `mod_tests`（纯函数那两条）。

use super::import::RowMap;
use super::{Conflict, TableSpec, SURROGATE_ID, UID};
use serde_json::Value;
use std::borrow::Cow;

/// 来源设备列：合成 uid 时必须一起补（见文件头最后两段）。
pub(super) const DEVICE_ID: &str = "device_id";

/// 需要的话返回「补过 uid / device_id」的行；不需要就原样借回（不 clone）。
pub(super) fn synthesize<'a>(
    spec: &TableSpec,
    row: &'a RowMap,
    bundle_device: &str,
) -> Cow<'a, RowMap> {
    let device = resolve_device(row, bundle_device);
    let Some(uid) = synthetic_uid(spec, row, &device) else {
        return Cow::Borrowed(row);
    };
    let mut owned = row.clone();
    owned.insert(UID.to_string(), Value::String(uid));
    owned.insert(DEVICE_ID.to_string(), Value::String(device));
    Cow::Owned(owned)
}

/// 行里有没有可用的 uid（`NULL` / 空串都算没有）。
pub(super) fn has_uid(row: &RowMap) -> bool {
    matches!(row.get(UID), Some(Value::String(uid)) if !uid.is_empty())
}

fn synthetic_uid(spec: &TableSpec, row: &RowMap, device: &str) -> Option<String> {
    /* 不按 uid 合并的表，合成 uid 没有意义（也没有唯一索引接它）。 */
    if !matches!(spec.conflict, Conflict::UidPartial | Conflict::UidPrimary) {
        return None;
    }
    let prefix = uid_prefix(spec.name)?;
    if has_uid(row) || device.is_empty() {
        return None;
    }
    let id = row.get(SURROGATE_ID).and_then(Value::as_i64)?;
    Some(format!("{prefix}{device}:{id}"))
}

/// 这一行属于哪台设备：行里的 `device_id` 优先（它才是属主），空串才退回包的 `deviceId`。
fn resolve_device(row: &RowMap, bundle_device: &str) -> String {
    match row.get(DEVICE_ID).and_then(Value::as_str).map(str::trim) {
        Some(device) if !device.is_empty() => device.to_string(),
        _ => bundle_device.trim().to_string(),
    }
}

/// 表 → uid 前缀，**与库里的触发器同一张表**。
///
/// `timer_ops` 是 `p:`（`0011_v0142` 的 `trg_timer_ops_uid`），**不是 `o:`** ——
/// `o:` 属于活动库的 `block_segment_override`（`data/sql/0030_item_attribution.sql`），
/// 两张表别混：混了就会给同一条操作日志发出两个身份。
/// `sessions` 的 `s:` 在 `data/sql/0028_device_dimension.sql`，
/// `app_category` 的 `c:` 在 `0030_item_attribution.sql`。
pub(super) fn uid_prefix(table: &str) -> Option<&'static str> {
    match table {
        "items" => Some("i:"),
        "item_app" => Some("b:"),
        "time_records" => Some("t:"),
        "timer_ops" => Some("p:"),
        "app_category" => Some("c:"),
        "sessions" => Some("s:"),
        _ => None,
    }
}
