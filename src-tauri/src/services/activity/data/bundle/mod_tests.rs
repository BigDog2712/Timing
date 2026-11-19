//! `bundle` 的纯函数单测：流式写盘的形状、`upsert_sql` 的两种 `ON CONFLICT` 写法、
//! 以及「uid 为空 → 合成」的规则（`synth.rs`）。
//!
//! 需要真库的语义用例在 `crate::tests::bundle`（预览 / 幂等 / 无 uid 表 skipped）
//! 与 `crate::tests::bundle_uid`（合成 uid 落库后非空且稳定 / 无 id 的退化路径）。

use super::sql::upsert_sql;
use super::synth;
use super::{BundleWriter, Conflict, TableSpec, UID};
use serde_json::{json, Value};

fn columns(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

fn row_of(value: Value) -> serde_json::Map<String, Value> {
    value.as_object().cloned().expect("测试行应是对象")
}

#[test]
fn writer_emits_one_object_per_row_and_keeps_table_order() {
    let mut writer = BundleWriter::new(Vec::new());
    writer
        .raw("{\"format\":\"timing.full-bundle.v1\",\"business\":{")
        .expect("raw 应成功");
    writer.open_table("items", true).expect("开表应成功");
    writer
        .row(&json!({ "id": 1, "uid": "i:dev-a:1", "name": "工作" }))
        .expect("写行应成功");
    writer
        .row(&json!({ "id": 2, "uid": null, "name": "学习" }))
        .expect("写行应成功");
    writer.close_table().expect("关表应成功");
    writer.open_table("todos", false).expect("开表应成功");
    writer.close_table().expect("关表应成功");
    writer.raw("}}").expect("raw 应成功");

    let parsed: Value = serde_json::from_slice(&writer.into_inner()).expect("必须是合法 JSON");
    assert_eq!(parsed["format"], "timing.full-bundle.v1");
    let items = parsed["business"]["items"]
        .as_array()
        .expect("items 应是数组");
    assert_eq!(items.len(), 2);
    /* 行是「列名 → 值」的对象：加列不会让旧解析错位。 */
    assert_eq!(items[0]["name"], "工作");
    assert_eq!(items[1]["uid"], Value::Null);
    assert_eq!(parsed["business"]["todos"], json!([]));
}

#[test]
fn partial_uid_index_forces_the_where_clause_on_conflict() {
    let sql = upsert_sql("items", &columns(&["uid", "name"]), Conflict::UidPartial);
    assert!(
        sql.contains("ON CONFLICT(\"uid\") WHERE \"uid\" IS NOT NULL DO UPDATE"),
        "部分唯一索引必须带同样的 WHERE，实际：{sql}"
    );
    /* 主键/合并键不能被自己覆盖。 */
    assert!(
        !sql.contains("\"uid\"=excluded"),
        "uid 不应进 SET，实际：{sql}"
    );
}

#[test]
fn lww_only_guards_when_the_version_column_travels() {
    let with_version = upsert_sql(
        "settings",
        &columns(&["key", "value", "updated_at"]),
        Conflict::KeyLww {
            key: "key",
            version: "updated_at",
        },
    );
    assert!(
        with_version.contains("WHERE excluded.\"updated_at\" > \"settings\".\"updated_at\""),
        "LWW 守卫缺失，实际：{with_version}"
    );
    /* 老包没有版本列时退化成普通覆盖，不能让整行插不进去。 */
    let without_version = upsert_sql(
        "settings",
        &columns(&["key", "value"]),
        Conflict::KeyLww {
            key: "key",
            version: "updated_at",
        },
    );
    assert!(
        !without_version.contains(" WHERE excluded."),
        "实际：{without_version}"
    );
}

#[test]
fn ignore_strategy_never_emits_a_conflict_target() {
    let sql = upsert_sql(
        "todos",
        &columns(&["id", "title"]),
        Conflict::InsertOrIgnore,
    );
    assert_eq!(
        sql,
        "INSERT OR IGNORE INTO \"todos\" (\"id\",\"title\") VALUES (?,?)",
    );
}

/// uid 类表的守卫：内容全等就不写 —— 否则 touch 触发器会把每行的 `updated_at_ms`
/// 推到「现在」，重复导入变成一次全库写风暴（判据 ② 就靠这条）。
#[test]
fn uid_upsert_only_writes_when_the_content_actually_changed() {
    let sql = upsert_sql(
        "items",
        &columns(&["uid", "name", "sort_order"]),
        Conflict::UidPartial,
    );
    assert!(
        sql.contains(
            " DO UPDATE SET \"name\"=excluded.\"name\",\"sort_order\"=excluded.\"sort_order\" \
             WHERE (excluded.\"name\" IS NOT \"items\".\"name\" \
             OR excluded.\"sort_order\" IS NOT \"items\".\"sort_order\")"
        ),
        "没变就不该写，实际：{sql}"
    );
    /* 合并键不参与比对（`IS NOT` 在键上恒为假，纯属噪音）。 */
    assert!(!sql.contains("excluded.\"uid\" IS NOT"), "实际：{sql}");
}

#[test]
fn synthetic_uid_follows_the_trigger_format() {
    let spec = TableSpec {
        name: "items",
        conflict: Conflict::UidPartial,
    };
    let row = row_of(json!({ "id": 7, "uid": null, "device_id": "" }));
    let patched = synth::synthesize(&spec, &row, "dev-a");
    assert_eq!(
        patched[UID],
        json!("i:dev-a:7"),
        "合成 uid 必须与触发器同格式"
    );
    /* 空串 `device_id` 一并补成来源设备：它的语义是「还没认领」。 */
    assert_eq!(patched[synth::DEVICE_ID], json!("dev-a"));
}

#[test]
fn synthetic_uid_prefers_the_rows_own_device_and_never_guesses() {
    let spec = TableSpec {
        name: "sessions",
        conflict: Conflict::UidPartial,
    };
    /* 行里有属主就用它（触发器本该发过 uid，这条路是给历史数据补救的）。 */
    let owned = row_of(json!({ "id": 3, "uid": null, "device_id": "dev-z" }));
    assert_eq!(
        synth::synthesize(&spec, &owned, "dev-a")[UID],
        json!("s:dev-z:3")
    );
    /* 没有 id：拿不到确定值 → 原样借回，调用方退化成 `INSERT OR IGNORE`。 */
    let no_id = row_of(json!({ "uid": null, "device_id": "" }));
    assert!(matches!(
        synth::synthesize(&spec, &no_id, "dev-a"),
        std::borrow::Cow::Borrowed(_)
    ));
    /* 没有设备：只剩 `s::3` 这种半截身份（迁移守卫拦的正是它）→ 不合成。 */
    let no_device = row_of(json!({ "id": 3, "uid": null, "device_id": "" }));
    assert!(matches!(
        synth::synthesize(&spec, &no_device, ""),
        std::borrow::Cow::Borrowed(_)
    ));
    /* 已经有 uid 的行一个字节都不动。 */
    let has_uid = row_of(json!({ "id": 3, "uid": "s:dev-z:3", "device_id": "" }));
    assert!(matches!(
        synth::synthesize(&spec, &has_uid, "dev-a"),
        std::borrow::Cow::Borrowed(_)
    ));
    /* 不按 uid 合并的表（`todos`）也没有前缀：一律原样借回。 */
    let todos = TableSpec {
        name: "todos",
        conflict: Conflict::InsertOrIgnore,
    };
    let row = row_of(json!({ "id": 1, "title": "买咖啡", "uid": null }));
    assert!(matches!(
        synth::synthesize(&todos, &row, "dev-a"),
        std::borrow::Cow::Borrowed(_)
    ));
}
