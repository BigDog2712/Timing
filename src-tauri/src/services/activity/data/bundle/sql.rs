//! 合并用的 SQL 三件套：**一行怎么变成一条 `INSERT`、键值怎么探存在性、值怎么绑定**。
//!
//! 拆出来是因为 `merge.rs` 已经贴着 300 行门禁（那边管「按什么顺序、丢哪些列」，
//! 这边只管「SQL 长什么样」）。两边都改的时候也更清楚该动哪一个。
//!
//! ## 两种 `ON CONFLICT` 的写法差别不是风格
//!
//! `uid` 上的唯一索引是**部分索引**（`CREATE UNIQUE INDEX ... WHERE uid IS NOT NULL`），
//! `ON CONFLICT(uid)` 不带同样的 `WHERE` 会被 SQLite 直接拒（"no matching clause"）。
//! `sync_tombstone` / `focus_blocks` 的 uid 是**主键**，带了 `WHERE` 反而报错。
//! 所以这里由 `Conflict` 枚举分派，而不是拼一个「通用」的 upsert。

use super::{Conflict, UID};
use serde_json::Value;
use sqlx::{Row, SqliteConnection};

/// 把一串 `Bind` 逐个挂到查询上。
///
/// `Query` 的完整类型是 `Query<'q, Sqlite, SqliteArguments<'q>>`，写出来太长、
/// 换个 sqlx 小版本就可能变；宏让类型交给编译器推断。
macro_rules! bind_all {
    ($query:expr, $binds:expr) => {{
        let mut query = $query;
        for bind in $binds {
            query = match bind {
                Bind::Null => query.bind(None::<String>),
                Bind::Int(value) => query.bind(value),
                Bind::Real(value) => query.bind(value),
                Bind::Text(value) => query.bind(value),
            };
        }
        query
    }};
}
pub(super) use bind_all;

/// 一个待绑定的值。SQLite 没有布尔，`Bool` 折成 0/1；对象/数组（正常包里没有）
/// 序列化回文本 —— 不因为一个怪值让整包失败。
pub(super) enum Bind {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl Bind {
    pub(super) fn of(value: &Value) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Bool(flag) => Self::Int(i64::from(*flag)),
            Value::Number(number) => match number.as_i64() {
                Some(value) => Self::Int(value),
                None => Self::Real(number.as_f64().unwrap_or_default()),
            },
            Value::String(text) => Self::Text(text.clone()),
            other => Self::Text(other.to_string()),
        }
    }
}

/// 这一行的合并键列名（顺序与 `key_values` 一致）。
pub(super) fn conflict_names(conflict: Conflict) -> Vec<&'static str> {
    match conflict {
        Conflict::UidPartial | Conflict::UidPrimary => vec![UID],
        Conflict::KeyLww { key, .. } => vec![key],
        Conflict::CompositeLww { keys, .. } => keys.to_vec(),
        Conflict::InsertOrIgnore => Vec::new(),
    }
}

/// 存在性判定用的键值；`None` = 该行缺合并键（整行跳过，不能瞎插）。
pub(super) fn key_values(
    conflict: Conflict,
    row: &serde_json::Map<String, Value>,
) -> Option<Vec<Value>> {
    let mut values = Vec::new();
    for name in conflict_names(conflict) {
        match row.get(name) {
            Some(Value::Null) | None => return None,
            Some(value) => values.push(value.clone()),
        }
    }
    Some(values)
}

/// 本地有没有这一行（决定算 `inserted` 还是 `updated`）。
pub(super) async fn exists(
    conn: &mut SqliteConnection,
    table: &str,
    conflict: Conflict,
    keys: &[Value],
) -> Result<bool, String> {
    let predicate = conflict_names(conflict)
        .iter()
        .map(|name| format!("\"{name}\" = ?"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" WHERE {predicate})");
    let binds: Vec<Bind> = keys.iter().map(Bind::of).collect();
    let row = bind_all!(sqlx::query(&sql), binds)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|error| format!("failed to probe {table}: {error}"))?;
    Ok(row
        .and_then(|row| row.try_get::<i64, _>(0).ok())
        .unwrap_or(0)
        != 0)
}

/// 一条 upsert 语句。
pub(super) fn upsert_sql(table: &str, columns: &[String], conflict: Conflict) -> String {
    let column_list = quoted_list(columns.iter().map(String::as_str));
    let marks = vec!["?"; columns.len()].join(",");
    if matches!(conflict, Conflict::InsertOrIgnore) {
        return format!("INSERT OR IGNORE INTO \"{table}\" ({column_list}) VALUES ({marks})");
    }
    let target = match conflict {
        /* 部分唯一索引：`ON CONFLICT` 后面必须跟同样的谓词，否则 SQLite 报「没有匹配」。 */
        Conflict::UidPartial => format!("(\"{UID}\") WHERE \"{UID}\" IS NOT NULL"),
        Conflict::UidPrimary => format!("(\"{UID}\")"),
        Conflict::KeyLww { key, .. } => format!("(\"{key}\")"),
        Conflict::CompositeLww { keys, .. } => format!("({})", quoted_list(keys.iter().copied())),
        Conflict::InsertOrIgnore => unreachable!(),
    };
    let key_names = conflict_names(conflict);
    let assignments = columns
        .iter()
        .filter(|name| !key_names.contains(&name.as_str()))
        .map(|name| format!("\"{name}\"=excluded.\"{name}\""))
        .collect::<Vec<_>>()
        .join(",");
    if assignments.is_empty() {
        return format!(
            "INSERT INTO \"{table}\" ({column_list}) VALUES ({marks}) ON CONFLICT{target} DO NOTHING"
        );
    }
    let guard = guard(table, columns, conflict);
    format!(
        "INSERT INTO \"{table}\" ({column_list}) VALUES ({marks}) ON CONFLICT{target} DO UPDATE SET {assignments}{guard}"
    )
}

/// 覆盖前的守卫。两种：uid 类表「**没变就不写**」，LWW 表「**不比本地新就不写**」。
fn guard(table: &str, columns: &[String], conflict: Conflict) -> String {
    match conflict {
        Conflict::UidPartial | Conflict::UidPrimary => changed_guard(table, columns, conflict),
        Conflict::KeyLww { version, .. } | Conflict::CompositeLww { version, .. } => {
            /* 版本列不在包里（老包 / 换过列名）时退化成普通覆盖：宁可覆盖，也不让整行插不进去。 */
            if !columns.iter().any(|name| name == version) {
                return String::new();
            }
            format!(" WHERE excluded.\"{version}\" > \"{table}\".\"{version}\"")
        }
        Conflict::InsertOrIgnore => String::new(),
    }
}

/// uid 类表的守卫：所有非键列逐一比对，全等就**不动这一行**。
///
/// 不只是省 I/O。`items` / `item_app` 上挂着 `AFTER UPDATE OF ...` 的 touch 触发器，
/// 无条件的 `DO UPDATE` 会把每一行的 `updated_at_ms` 推到「现在」——导入于是变成一次
/// 「全库都改过」的写风暴，同步侧还会为每一行发一次增量。有了这道守卫，「同一份包
/// 再导一次」才是真的什么都没变（`tests::bundle` 的幂等用例钉着这条判据）。
///
/// `IS NOT` 是 null-safe 的（`1 IS NOT NULL` 为真、`NULL IS NOT NULL` 为假），
/// 所以空列也能正确判等。
fn changed_guard(table: &str, columns: &[String], conflict: Conflict) -> String {
    let keys = conflict_names(conflict);
    let diffs = columns
        .iter()
        .filter(|name| !keys.contains(&name.as_str()))
        .map(|name| format!("excluded.\"{name}\" IS NOT \"{table}\".\"{name}\""))
        .collect::<Vec<_>>();
    if diffs.is_empty() {
        return String::new();
    }
    format!(" WHERE ({})", diffs.join(" OR "))
}

fn quoted_list<'a>(names: impl Iterator<Item = &'a str>) -> String {
    names
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(",")
}
