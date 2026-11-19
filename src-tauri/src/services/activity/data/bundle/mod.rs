//! 全额数据包（单个 JSON）的 schema 契约、表清单与流式写盘工具。
//!
//! ## 为什么是「列名 → 值」的对象
//!
//! 包里的每一行都是 `{"列名": 值}`，不是数组。理由只有一个但在真机上很值钱：
//! **加列不炸旧包**。写死位置（`[22, "工作", ...]`）意味着任何一次迁移加列，
//! 旧包就整体错位——错位不会报错，只会把 `color` 塞进 `status`。
//!
//! ## 表清单为什么写死在这里（而不是 `SELECT name FROM sqlite_master`）
//!
//! 全量导表的诱惑很大，但库里有 `_sqlx_migrations`（迁移元数据）、`md_cloud_pending`
//! （在途队列）、`sync_suppress`（临时抑制）、`read_model_*`（可重算的读模型）这类
//! **不该跨设备搬**的东西。清单写死 = 明确「哪些是用户数据」，顺带让导入顺序可控。
//!
//! ## 每张表的合并策略在 `merge.rs`，这里只标「冲突目标在哪」
//!
//! `uid` 上的唯一索引**几乎都是部分索引**（`WHERE uid IS NOT NULL`），所以
//! `ON CONFLICT(uid)` 必须带同样的 `WHERE`，否则 SQLite 直接报「没有匹配的索引」——
//! 这条在 `mod_tests.rs` 的往返用例里被钉住。`sync_tombstone` / `focus_blocks` 的 uid
//! 是**主键**（无部分索引），走 `UidPrimary`。
//!
//! ## 模块划分
//!
//! `export.rs` 流式写盘（只读两个库）→ `import.rs` 预览与编排 → `merge.rs` 逐表合并，
//! 缺 `uid` 的行由 `synth.rs` 先补一个确定性 uid（真机 `items` 的 uid 全空，见那份文件头）。
//! 四个文件都被 `check:size` 卡着，拆开是为了不让任何一份越过 300 行。

use serde_json::{Map, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, ValueRef};
use std::io::{self, Write};

mod export;
mod import;
mod merge;
mod sql;
mod synth;

pub use export::{export_full_bundle, ExportSummary};
pub use import::{import_full_bundle, inspect_file, ImportSummary, InspectSummary};

/// 包格式标识。**导入按它判兼容**：不是这个值就只预览、不放行导入。
pub const FORMAT: &str = "timing.full-bundle.v1";

/// 自增主键列名。uid 合并的表在导入时**丢掉它**（理由见 `merge.rs`）。
pub(crate) const SURROGATE_ID: &str = "id";

/// 跨设备身份列：`i:<device>:<id>`，也是绝大多数表的合并键。
pub(crate) const UID: &str = "uid";

/// 引用「事项本地 id」的列：导入时按 `items` 的源 id → 本地 id 映射改写。
pub(crate) const REMAP_COLUMNS: &[&str] = &["item_id", "parent_id"];

/// 冲突目标 → 决定 `INSERT ... ON CONFLICT(...)` 怎么写。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Conflict {
    /// `uid` 上有 `WHERE uid IS NOT NULL` 的部分唯一索引。缺 `uid` 的行先被 `synth.rs`
    /// 补一个确定性 uid（`<前缀><来源设备>:<包里的 id>`）；实在补不出来才退化成 `OR IGNORE`。
    UidPartial,
    /// `uid` 就是主键（没有部分索引）。
    UidPrimary,
    /// `key` 主键 + 版本列 LWW（业务库 `settings`：`updated_at` 更大的赢）。
    KeyLww {
        key: &'static str,
        version: &'static str,
    },
    /// 复合业务键 + 版本列 LWW（`app_usage` / `app_category`）。
    CompositeLww {
        keys: &'static [&'static str],
        version: &'static str,
    },
    /// 没有业务键可用：本地没有才插，有就 `skipped`。
    InsertOrIgnore,
}

pub(crate) struct TableSpec {
    pub name: &'static str,
    pub conflict: Conflict,
}

/// 本机业务库（`timing.db`）里属于「用户数据」的表，按导入顺序排。
///
/// [批 2] `app_usage` 是本批**加进契约**的一张表：产品口径要求「手机端数据」跟着走，
/// 而它就是手机端上传的每日应用使用（`package_name + local_date`）。原清单没有它，
/// 不加就等于「导出的包里没有手机端数据」。
pub(crate) const BUSINESS_TABLES: &[TableSpec] = &[
    TableSpec {
        name: "items",
        conflict: Conflict::UidPartial,
    },
    TableSpec {
        name: "item_app",
        conflict: Conflict::UidPartial,
    },
    TableSpec {
        name: "time_records",
        conflict: Conflict::UidPartial,
    },
    TableSpec {
        name: "timer_ops",
        conflict: Conflict::UidPartial,
    },
    TableSpec {
        name: "todos",
        conflict: Conflict::InsertOrIgnore,
    },
    TableSpec {
        name: "notes",
        conflict: Conflict::InsertOrIgnore,
    },
    TableSpec {
        name: "sync_tombstone",
        conflict: Conflict::UidPrimary,
    },
    TableSpec {
        name: "app_usage",
        conflict: Conflict::CompositeLww {
            keys: &["package_name", "local_date"],
            version: "updated_at",
        },
    },
    TableSpec {
        name: "settings",
        conflict: Conflict::KeyLww {
            key: "key",
            version: "updated_at",
        },
    },
];

/// 分析窗活动库（`patina/data/patina.db`）里属于「用户数据」的表，按导入顺序排。
///
/// `icon_cache` 保留在包里：它的列已经是 `TEXT`（base64），没有 blob 要处理；
/// 跳过它在导入后会让首屏一片灰图标（图标要等各自重新扫到才回来）。
/// `app_category` 的合并键取 `(app_key, category_key)`——表上有这条 `UNIQUE`，
/// 而 `uq_app_category_uid` 只是部分索引；换机场景里「同一个应用的同一个分类」
/// 才是语义上的同一行，vendored 侧的 `repositories/app_category.rs` 也是这么合的。
pub(crate) const ACTIVITY_TABLES: &[TableSpec] = &[
    TableSpec {
        name: "app_category",
        conflict: Conflict::CompositeLww {
            keys: &["app_key", "category_key"],
            version: "updated_at",
        },
    },
    TableSpec {
        name: "focus_blocks",
        conflict: Conflict::UidPrimary,
    },
    TableSpec {
        name: "sessions",
        conflict: Conflict::UidPartial,
    },
    TableSpec {
        name: "icon_cache",
        conflict: Conflict::InsertOrIgnore,
    },
    TableSpec {
        name: "settings",
        conflict: Conflict::InsertOrIgnore,
    },
];

/// **不跨设备**搬的 `settings` 键（导入时跳过并按 `skipped` 计数）。
///
/// 三类：① 本机身份/凭据（搬到另一台机器等于冒用别人的凭据）；② 指向本地自增 id
/// 或 schema 版本的键（旧包覆盖 `schema.version` 会让迁移逻辑判错版本）；③ MD 同步
/// 端点配置（导入后可能让本机已有凭据发往包指定的服务器）。
/// 导出**照常全导**：包里留着才能看出「当时是什么配置」，只是不往本地写。
pub(crate) const NON_PORTABLE_SETTING_KEYS: &[&str] = &[
    "schema.version",
    "ui.last_item_id",
    "remote_status_bridge_machine_id",
    "remote_status_bridge_token",
    "web_activity_token",
    "plugin.md-sync.config",
    /* [0.12.3] AI 配置不跨设备：密钥在各自的凭据存储里，把地址与开关搬过去只会让
    另一台机器拿着「看起来已配置」的空壳反复失败。包里照常留着（可追溯）。 */
    "ai.config",
    "__tracker_last_heartbeat_ms",
    "__tracker_last_successful_sample_ms",
    "__tracker_last_startup_self_heal_at_ms",
    "__tracker_last_startup_self_heal_summary",
];

/// 流式写 JSON 的小工具：一层数组一个 `first` 标记，行用 `serde_json::to_writer` 转义。
///
/// 为什么不直接 `serde_json::to_writer(&bundle)`：10 万行 sessions 全量进内存要几百 MB，
/// 而导出是一次**只读**动作，没有理由为它把整个库读进堆里。这里逐行写、逐表关，
/// 内存只跟一行有关。
pub(crate) struct BundleWriter<W: Write> {
    out: W,
    first_in_array: bool,
}

impl<W: Write> BundleWriter<W> {
    pub fn new(out: W) -> Self {
        Self {
            out,
            first_in_array: true,
        }
    }

    /// 原样写结构性文本（`{`、`"business":{`、`]` 这些）。转义责任在调用方。
    pub fn raw(&mut self, text: &str) -> io::Result<()> {
        self.out.write_all(text.as_bytes())
    }

    /// 开一个表数组：`,"items":[`（第一张表没有前导逗号）。
    pub fn open_table(&mut self, name: &str, first_table: bool) -> io::Result<()> {
        if !first_table {
            self.out.write_all(b",")?;
        }
        write!(self.out, "\"{name}\":[")?;
        self.first_in_array = true;
        Ok(())
    }

    /// 写一行（`{"列名":值}`），自动补逗号。
    pub fn row(&mut self, value: &Value) -> io::Result<()> {
        if !self.first_in_array {
            self.out.write_all(b",")?;
        }
        self.first_in_array = false;
        serde_json::to_writer(&mut self.out, value).map_err(io::Error::other)
    }

    pub fn close_table(&mut self) -> io::Result<()> {
        self.out.write_all(b"]")
    }

    pub fn into_inner(self) -> W {
        self.out
    }
}

/// 一行 → `{"列名": 值}`。
///
/// SQLite 是动态类型：声明成 `TEXT` 的列里躺着整数是合法的。所以按**取值**依次退让
/// （i64 → f64 → String），而不是按声明类型硬取——硬取会在一条脏数据上整包失败。
pub(crate) fn row_to_value(row: &SqliteRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        object.insert(column.name().to_string(), cell(row, index));
    }
    Value::Object(object)
}

fn cell(row: &SqliteRow, index: usize) -> Value {
    let raw = match row.try_get_raw(index) {
        Ok(raw) => raw,
        Err(_) => return Value::Null,
    };
    if raw.is_null() {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Value::from(value);
    }
    if let Ok(value) = row.try_get::<f64, _>(index) {
        return Value::from(value);
    }
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Value::from(value);
    }
    /* BLOB（目前只有极端脏数据会出现）：不塞进 JSON，如实留空。
    宁可丢一个二进制字段，也不让整包因为一行坏数据导不出来。 */
    Value::Null
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
