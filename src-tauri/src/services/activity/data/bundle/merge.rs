//! 逐表合并：一份 `TableSpec` + 一批行 → 一条 `TableStat`。
//!
//! SQL 长什么样在 `sql.rs`；这里管**顺序与取舍**（哪些列写、哪些列丢、引用怎么改写）。
//!
//! ## `id` 为什么必须丢
//!
//! uid 类表的 `id` 是本地自增号，而 uid 恰好是 `i:<device>:<id>`。**换机导入**时
//! 目标库里 `id=1` 已经被本机的默认事项占着（uid 不同）——带着 `id` 插入会撞
//! 主键，`ON CONFLICT(uid)` 盖不住它，整包回滚。所以 uid 类表一律**不带 `id`**，
//! 让本地重新发号；引用关系靠 `ItemMap`（源 id → 本地 id）改写。
//!
//! ## uid 为空的行：先**合成** uid，而不是按 `id` 忽略
//!
//! 真机库里 `items` 的 `uid` 全空（原因见 `synth.rs` 的文件头）。那种行没有合并键，
//! 老写法退化成「带 `id` 插入 + 已存在就忽略」——包里的 `id` 与目标库种子撞车就静默
//! 丢一行。现在改成：只要行里有原始 `id`、且有来源设备，就按
//! `synth.rs` 的规则补一个确定性 uid，然后照常走 uid upsert（`id` 也随之丢掉）。
//! **只有连原始 `id` 都没有的行**才继续退化成 `INSERT OR IGNORE`。
//!
//! ## 两遍写 `items`
//!
//! `SELECT *` 的行序不保证父在子前，所以 `items.parent_id` 第一遍不写（丢列），
//! 等整表插完、映射齐了再逐行 `UPDATE`。其余子表的 `item_id` 一遍就够（items 已落库）。
//!
//! ## `sessions.app_key` 是生成列
//!
//! 它由 `GENERATED ALWAYS AS (...)` 算出来，`INSERT` 进去直接报错。所以列清单用
//! `PRAGMA table_xinfo` 取、只留 `hidden = 0` 的普通列——包里的生成列值原样留着，
//! 只是不往本地写。

use super::export::table_exists_on;
use super::import::{RowMap, TableStat};
use super::sql::{bind_all, exists, key_values, upsert_sql, Bind};
use super::synth::{has_uid, synthesize};
use super::{Conflict, TableSpec, NON_PORTABLE_SETTING_KEYS, REMAP_COLUMNS, SURROGATE_ID, UID};
use serde_json::Value;
use sqlx::{Row, SqliteConnection};
use std::collections::HashMap;

const ITEMS_TABLE: &str = "items";
const SETTINGS_TABLE: &str = "settings";
const KEY: &str = "key";
/// 推迟到第二遍写的列（只有 `items` 用）。
const DEFERRED_PARENT: &str = "parent_id";

/// 源 `id` → 本地 `id`。只有 `items` 会往里写，其余表只读。
#[derive(Debug, Default)]
pub(super) struct ItemMap {
    pairs: HashMap<i64, i64>,
}

impl ItemMap {
    pub(super) fn extend(&mut self, pairs: Vec<(i64, i64)>) {
        self.pairs.extend(pairs);
    }

    fn remap(&self, column: &str, value: &Value) -> Option<Value> {
        if !REMAP_COLUMNS.contains(&column) {
            return None;
        }
        let source = value.as_i64()?;
        self.pairs.get(&source).map(|local| Value::from(*local))
    }
}

/// 合并一张表。返回 `(统计, 本表发现的 源id→本地id)`——只有 `items` 会返回非空。
///
/// `device` 是包的来源设备（`bundle.deviceId`），只服务一件事：给 uid 为空的行
/// 合成 uid 时，行的 `device_id` 也是空串就退回它（见 `synth.rs`）。
pub(super) async fn import_table(
    conn: &mut SqliteConnection,
    spec: &TableSpec,
    rows: &[RowMap],
    map: &ItemMap,
    device: &str,
) -> Result<(TableStat, Vec<(i64, i64)>), String> {
    let mut stat = TableStat {
        name: spec.name.to_string(),
        inserted: 0,
        updated: 0,
        skipped: 0,
    };
    if rows.is_empty() {
        return Ok((stat, Vec::new()));
    }
    if !table_exists_on(conn, spec.name).await? {
        /* 旧库没有这张表：整表跳过并如实计数（包比库新是正常的，不是错误）。 */
        stat.skipped = rows.len() as u64;
        return Ok((stat, Vec::new()));
    }
    let columns = insertable_columns(conn, spec.name).await?;
    let mut discovered: Vec<(i64, i64)> = Vec::new();
    for row in rows {
        /* ① 先补 uid：之后的冲突策略、可写列、引用改写全看这一份「有效行」。 */
        let effective = synthesize(spec, row, device);
        let row = effective.as_ref();
        if is_non_portable_setting(spec, row) {
            stat.skipped += 1;
            continue;
        }
        let conflict = row_conflict(spec, row);
        let used = allowed_columns(spec, &columns, row, conflict);
        if used.is_empty() {
            stat.skipped += 1;
            continue;
        }
        let Some(keys) = key_values(conflict, row) else {
            stat.skipped += 1;
            continue;
        };
        let existed = !keys.is_empty() && exists(conn, spec.name, conflict, &keys).await?;
        let sql = upsert_sql(spec.name, &used, conflict);
        let binds: Vec<Bind> = used
            .iter()
            .map(|name| {
                let raw = row.get(name).unwrap_or(&Value::Null);
                let value = map.remap(name, raw).unwrap_or_else(|| raw.clone());
                Bind::of(&value)
            })
            .collect();
        let affected = bind_all!(sqlx::query(&sql), binds)
            .execute(&mut *conn)
            .await
            .map_err(|error| format!("failed to import into {}: {error}", spec.name))?
            .rows_affected();
        match (affected, existed) {
            (0, _) => stat.skipped += 1,
            (_, true) => stat.updated += 1,
            (_, false) => stat.inserted += 1,
        }
        if spec.name == ITEMS_TABLE {
            remember_item(conn, row, &mut discovered).await?;
        }
    }
    if !discovered.is_empty() {
        apply_deferred_parents(conn, rows, &discovered).await?;
    }
    Ok((stat, discovered))
}

/// 本表的行用哪种冲突策略：uid 类表缺 uid 时降级成 `INSERT OR IGNORE`。
///
/// 注意这是**兜底**：`synth.rs` 已经把「有 `id` 且有来源设备」的行补上了 uid，
/// 走到这里还缺 uid 的只剩三种（没有 `id` / 没有设备 / 表不在前缀表里），
/// 那时确实没有合并键可用，只能按 `id` 忽略。
fn row_conflict(spec: &TableSpec, row: &RowMap) -> Conflict {
    if !matches!(spec.conflict, Conflict::UidPartial | Conflict::UidPrimary) {
        return spec.conflict;
    }
    if has_uid(row) {
        spec.conflict
    } else {
        Conflict::InsertOrIgnore
    }
}

/// 这一行实际写哪些列：`SELECT *` 里有、库里也有、且不是要丢的 / 要推迟的。
fn allowed_columns(
    spec: &TableSpec,
    columns: &[String],
    row: &RowMap,
    conflict: Conflict,
) -> Vec<String> {
    let drop_id = matches!(conflict, Conflict::UidPartial | Conflict::UidPrimary);
    columns
        .iter()
        .filter(|name| row.contains_key(*name))
        .filter(|name| !(drop_id && name.as_str() == SURROGATE_ID))
        .filter(|name| !(spec.name == ITEMS_TABLE && name.as_str() == DEFERRED_PARENT))
        .cloned()
        .collect()
}

/// 插完 `items` 之后补 `parent_id`（行序不保证父在子前，见文件头）。
async fn apply_deferred_parents(
    conn: &mut SqliteConnection,
    rows: &[RowMap],
    pairs: &[(i64, i64)],
) -> Result<(), String> {
    let lookup: HashMap<i64, i64> = pairs.iter().copied().collect();
    for row in rows {
        let Some(source_parent) = row.get(DEFERRED_PARENT).and_then(Value::as_i64) else {
            continue;
        };
        let Some(local) = row
            .get(SURROGATE_ID)
            .and_then(Value::as_i64)
            .and_then(|source| lookup.get(&source))
        else {
            continue;
        };
        let Some(local_parent) = lookup.get(&source_parent) else {
            continue;
        };
        /* `AND parent_id IS NOT ?`：父没变就别写。`items` 上挂着 `AFTER UPDATE OF parent_id`
        的 touch 触发器，无条件的写会把 `updated_at_ms` 推到「现在」——重复导入于是
        变成一次全库写风暴（判据 ②：再导一次 `total_updated == 0`）。 */
        sqlx::query(&format!(
            "UPDATE \"{ITEMS_TABLE}\" SET \"{DEFERRED_PARENT}\" = ? \
             WHERE \"id\" = ? AND \"{DEFERRED_PARENT}\" IS NOT ?"
        ))
        .bind(*local_parent)
        .bind(*local)
        .bind(*local_parent)
        .execute(&mut *conn)
        .await
        .map_err(|error| format!("failed to remap parent of item {local}: {error}"))?;
    }
    Ok(())
}

async fn remember_item(
    conn: &mut SqliteConnection,
    row: &RowMap,
    discovered: &mut Vec<(i64, i64)>,
) -> Result<(), String> {
    let Some(source) = row.get(SURROGATE_ID).and_then(Value::as_i64) else {
        return Ok(());
    };
    let local = match row.get(UID).and_then(Value::as_str) {
        /* 有 uid 就按 uid 找回本地 id：合成出来的 uid 也走这条路（`id` 已经被丢掉）。 */
        Some(uid) if !uid.is_empty() => local_id_by_uid(conn, ITEMS_TABLE, uid).await?,
        /* 退化路径：`id` 没被丢掉，本地 id 就是源 id。 */
        _ => Some(source),
    };
    if let Some(local) = local {
        discovered.push((source, local));
    }
    Ok(())
}

async fn local_id_by_uid(
    conn: &mut SqliteConnection,
    table: &str,
    uid: &str,
) -> Result<Option<i64>, String> {
    sqlx::query_scalar::<_, i64>(&format!(
        "SELECT \"id\" FROM \"{table}\" WHERE \"{UID}\" = ?"
    ))
    .bind(uid)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| format!("failed to resolve local id in {table}: {error}"))
}

/// `settings` 里那一小撮**不跨设备**的键（见 `mod.rs` 的 `NON_PORTABLE_SETTING_KEYS`）。
fn is_non_portable_setting(spec: &TableSpec, row: &RowMap) -> bool {
    if spec.name != SETTINGS_TABLE {
        return false;
    }
    match row.get(KEY).and_then(Value::as_str) {
        Some(key) => NON_PORTABLE_SETTING_KEYS.contains(&key),
        None => false,
    }
}

/// 可写列清单（`hidden != 0` 的生成列/隐藏列一律排除）。
async fn insertable_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(&format!("PRAGMA table_xinfo(\"{table}\")"))
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| format!("failed to read columns of {table}: {error}"))?;
    let mut columns = Vec::new();
    for row in &rows {
        let hidden = row
            .try_get::<i64, _>("hidden")
            .map_err(|error| format!("failed to read column visibility of {table}: {error}"))?;
        /* hidden: 0 普通列 / 1 隐藏列 / 2 生成列（虚拟）/ 3 生成列（存储）。后三类都不能写。 */
        if hidden != 0 {
            continue;
        }
        let name = row
            .try_get::<String, _>("name")
            .map_err(|error| format!("failed to read column name of {table}: {error}"))?;
        columns.push(name);
    }
    Ok(columns)
}
