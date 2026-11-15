//! [批 2 · 返工] uid 为空的行：**合成 uid** 的两条可执行判据。
//!
//! 背景（`synth.rs` 文件头有完整版）：`adopt_business_rows` 只认领 `time_records`，
//! 真机 `items` 的 `uid` 至今全空。老写法「uid 为空 → `INSERT OR IGNORE` 且保留 `id`」
//! 会让换机导入按自增 id 幂等 —— 撞上目标库种子就**静默丢一行**。
//!
//! · ③ 源行 uid 为空、包里有 `id` → 导入后 uid 非空、形状与触发器同格式、重复导入稳定；
//! · ④ 连原始 `id` 都没有 → 继续退化成 `INSERT OR IGNORE`（不报错、不合成、不会凭空
//!   得到身份）。
//!
//! 真机版本的同一件事在 `tests::bundle_real_data`（`#[ignore]`，本机手动跑）。

use crate::services::insight::data::bundle::{export_full_bundle, import_full_bundle};
use crate::tests::bundle::activity_pool;
use crate::tests::support;
use std::path::PathBuf;

/// 一个「从没认领过设备」的来源设备 id：真机 `items.device_id` 就是空串，
/// 导出虽然带上了 `deviceId`，但种子行本身没有属主 —— 正好是要覆盖的形状。
const DEVICE: &str = "dev-never-claimed";

fn bundle_path(tag: &str) -> PathBuf {
    let dir = support::unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("建临时目录");
    dir.join("Timing-full.json")
}

fn temp_bundle(tag: &str, body: &str) -> PathBuf {
    let path = bundle_path(tag);
    std::fs::write(&path, body).expect("写包");
    path
}

/// 判据 ③：源行 uid 为空、包内有 id → 导入后 uid 非空且**稳定**。
#[tokio::test]
async fn an_item_without_uid_gets_a_stable_synthetic_uid() {
    let source = support::fresh_pool("bundle-uid-src").await;
    let (source_activity, _) = activity_pool("bundle-uid-src-act").await;
    /* 源库停在「还没认领」的状态：种子事项 uid 是 NULL、device_id 是空串。 */
    assert_eq!(
        support::scalar_i64(&source, "SELECT COUNT(*) FROM items WHERE uid IS NULL").await,
        1,
        "前提：空库的种子事项没有 uid"
    );

    let path = bundle_path("bundle-uid");
    export_full_bundle(&source, &source_activity, &path, DEVICE)
        .await
        .expect("导出应成功");

    let target = support::fresh_pool("bundle-uid-dst").await;
    let (target_activity, _) = activity_pool("bundle-uid-dst-act").await;
    import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("导入应成功");

    /* 合成 uid 的形状 = 触发器的形状：i:<来源设备>:<包里的原始 id>，device_id 一并补齐。 */
    let expected = format!("i:{DEVICE}:1");
    assert_eq!(
        support::scalar_i64(
            &target,
            &format!("SELECT COUNT(*) FROM items WHERE uid = '{expected}' AND device_id = '{DEVICE}'"),
        )
        .await,
        1,
        "合成 uid 应是 `i:<device>:<id>` 且 device_id 同步补齐"
    );
    /* 判据 ④（全库口径）：唯一 uid 为空的只剩目标库自带的种子那一行。 */
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items WHERE uid IS NULL").await,
        1,
        "导入产生了 uid 为空的事项"
    );

    /* 判据 ②：同一份包再导一次 → 一行不插、一行不改，uid 还是那一个。 */
    let rows_before = support::scalar_i64(&target, "SELECT COUNT(*) FROM items").await;
    let second = import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("第二次导入应成功");
    assert_eq!(second.total_inserted, 0, "第二次不应再插行：{:?}", second.tables);
    assert_eq!(second.total_updated, 0, "第二次不应再改行：{:?}", second.tables);
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items").await,
        rows_before,
        "重复导入不许长出新事项"
    );
    assert_eq!(
        support::scalar_i64(&target, &format!("SELECT COUNT(*) FROM items WHERE uid = '{expected}'"))
            .await,
        1,
        "合成 uid 必须是确定值（重复导入不变）"
    );
}

/// 判据 ④：连原始 `id` 都没有的行 → 继续退化成 `INSERT OR IGNORE`，整包不失败。
#[tokio::test]
async fn a_row_without_a_surrogate_id_degrades_to_insert_or_ignore() {
    /* 手写的包（真实包不会是这样：导出走 `SELECT *`，`id` 一定在）。 */
    let bundle = r#"{
        "format": "timing.full-bundle.v1",
        "exportedAtMs": 1,
        "appVersion": "test",
        "deviceId": "dev-never-claimed",
        "business": {
            "items": [
                {"name": "没有 id 的事项", "status": "active", "is_system": 0,
                 "sort_order": 0, "created_at": 1, "updated_at": 1,
                 "device_id": "", "uid": null, "updated_at_ms": 1}
            ]
        },
        "activity": {}
    }"#;
    let path = temp_bundle("bundle-noid", bundle);

    let target = support::fresh_pool("bundle-noid-dst").await;
    let (target_activity, _) = activity_pool("bundle-noid-dst-act").await;
    let first = import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("没有 id 的行不该让整包失败");
    let stat = first
        .tables
        .iter()
        .find(|stat| stat.name == "business.items")
        .expect("应回报 items 统计");
    assert_eq!(
        stat.inserted + stat.updated + stat.skipped,
        1,
        "那一行必须被处理过：{stat:?}"
    );
    /* 没有 id 就没有确定性的合成输入 ⇒ uid 仍然是空（本机 device_id 也是空串，
       连触发器都不会发放 uid）。**这是已知退化**：真实包不会走到这里。 */
    assert_eq!(
        support::scalar_i64(
            &target,
            "SELECT COUNT(*) FROM items WHERE name = '没有 id 的事项' AND uid IS NULL",
        )
        .await,
        1,
        "没有 id 的行不该凭空得到身份"
    );
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items WHERE uid LIKE 'i:%'").await,
        0,
        "没有 id 的行不该被合成 uid"
    );
}
