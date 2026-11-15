//! 全额数据包导入：**只 merge，不 replace**。
//!
//! ## 为什么不是 replace
//!
//! 「导入」在用户心里的默认语义是「把包里的东西并进来」，不是「拿包覆盖我现在的库」。
//! replace 的代价不可逆（本地独有的行直接消失），而 merge 的最坏结果只是多了几行。
//! 需要「清干净再导入」的用户可以先自己清理（设置 → 数据 → 清理历史），那是显式动作。
//!
//! ## 合并键由 `mod.rs` 的 `TableSpec` 决定，逐行合并在 `merge.rs`
//!
//! `uid` 表按 `uid` upsert（部分唯一索引要带 `WHERE uid IS NOT NULL`）；
//! 无 `uid` 的表按业务键或 `INSERT OR IGNORE`；`settings` 走 LWW。
//! 这里只负责：解析 → 预览（**只读**）→ 开事务 → 按顺序逐表调 `merge`。
//!
//! ## `device_id` 保留包里的原值
//!
//! 它是**来源设备**的身份，uid 里已经带着（`i:<device>:<id>`）。改成本机 id 会让
//! uid 与库内既有行的口径打架；本机 `install_id.txt` 也一个字节都不动。
//! 唯一的例外是「行里原本是空串」：空串的含义是「还没认领」，不该由导入产生，
//! 于是补成包的 `deviceId` 再落库（见 `synth.rs`）。
//!
//! ## 先交活动库、后交业务库
//!
//! 业务库是主：任一步失败，两个 `Transaction` 在 drop 时各自回滚，整包不留痕。

use super::merge::{import_table, ItemMap};
use super::{ACTIVITY_TABLES, BUSINESS_TABLES, FORMAT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Pool, Sqlite};
use std::collections::BTreeMap;
use std::path::Path;

pub(super) type RowMap = serde_json::Map<String, Value>;

/// 预览与统计里的表名带库前缀：两个库里都有 `settings`，不带前缀前端会看到
/// 两行同名、数字不同（而且 `totalRows` 会算错一份）。形如 `business.items`。
pub(super) const BUSINESS_PREFIX: &str = "business.";
pub(super) const ACTIVITY_PREFIX: &str = "activity.";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Bundle {
    format: String,
    exported_at_ms: i64,
    app_version: String,
    device_id: String,
    business: BTreeMap<String, Vec<RowMap>>,
    activity: BTreeMap<String, Vec<RowMap>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCount {
    pub name: String,
    pub rows: u64,
}

/// 导入前预览（**只读**：不建表、不写库、不动 `install_id.txt`）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSummary {
    pub format: String,
    pub exported_at_ms: i64,
    pub app_version: String,
    pub device_id: String,
    pub tables: Vec<TableCount>,
    pub total_rows: u64,
    pub compatible: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStat {
    pub name: String,
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub tables: Vec<TableStat>,
    pub total_inserted: u64,
    pub total_updated: u64,
}

/// 读包并出预览。纯函数（只吃字节），单测直接喂 `serde_json::to_vec`。
pub fn inspect_bytes(raw: &[u8]) -> Result<InspectSummary, String> {
    Ok(inspect_bundle(&parse(raw)?))
}

pub fn inspect_file(path: &Path) -> Result<InspectSummary, String> {
    let raw = std::fs::read(path).map_err(|error| format!("failed to read bundle: {error}"))?;
    inspect_bytes(&raw)
}

/// 导入：两个库各开一个事务，任一表失败整包回滚（原文报错，不润色）。
pub async fn import_full_bundle(
    business: &Pool<Sqlite>,
    activity: &Pool<Sqlite>,
    path: &Path,
) -> Result<ImportSummary, String> {
    let raw = std::fs::read(path).map_err(|error| format!("failed to read bundle: {error}"))?;
    let bundle = parse(&raw)?;
    let preview = inspect_bundle(&bundle);
    if !preview.compatible {
        return Err(preview.message);
    }

    let mut business_tx = business.begin().await.map_err(|error| error.to_string())?;
    let mut stats = Vec::new();
    /* 事项的源 id → 本地 id：子表（item_app / time_records / todos / notes）与
       items.parent_id 都靠它改写引用。必须先走 items。 */
    let mut items = ItemMap::default();
    for spec in BUSINESS_TABLES {
        let rows = bundle
            .business
            .get(spec.name)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let (mut stat, discovered) =
            import_table(business_tx.as_mut(), spec, rows, &items, &bundle.device_id).await?;
        stat.name = format!("{BUSINESS_PREFIX}{}", stat.name);
        items.extend(discovered);
        stats.push(stat);
    }
    let mut activity_tx = activity.begin().await.map_err(|error| error.to_string())?;
    for spec in ACTIVITY_TABLES {
        let rows = bundle
            .activity
            .get(spec.name)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let (mut stat, _) =
            import_table(activity_tx.as_mut(), spec, rows, &items, &bundle.device_id).await?;
        stat.name = format!("{ACTIVITY_PREFIX}{}", stat.name);
        stats.push(stat);
    }
    activity_tx
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    business_tx.commit().await.map_err(|error| error.to_string())?;

    let total_inserted = stats.iter().map(|stat| stat.inserted).sum();
    let total_updated = stats.iter().map(|stat| stat.updated).sum();
    Ok(ImportSummary {
        tables: stats,
        total_inserted,
        total_updated,
    })
}

fn parse(raw: &[u8]) -> Result<Bundle, String> {
    serde_json::from_slice(raw).map_err(|error| format!("这不是一个合法的 JSON 数据包：{error}"))
}

fn inspect_bundle(bundle: &Bundle) -> InspectSummary {
    let mut tables = Vec::new();
    let mut total_rows = 0_u64;
    let mut non_empty = 0_usize;
    for (prefix, section, specs) in [
        (BUSINESS_PREFIX, &bundle.business, BUSINESS_TABLES),
        (ACTIVITY_PREFIX, &bundle.activity, ACTIVITY_TABLES),
    ] {
        for spec in specs {
            let rows = section
                .get(spec.name)
                .map(|rows| rows.len() as u64)
                .unwrap_or(0);
            if rows > 0 {
                non_empty += 1;
            }
            total_rows += rows;
            tables.push(TableCount {
                name: format!("{prefix}{}", spec.name),
                rows,
            });
        }
    }
    let compatible = bundle.format == FORMAT;
    let message = if compatible {
        format!("可以导入：{non_empty} 张表 / {total_rows} 行")
    } else if bundle.format.is_empty() {
        format!("包里没有 format 字段，本机只认 {FORMAT}")
    } else {
        format!("包格式是 {}，本机只认 {FORMAT}", bundle.format)
    };
    InspectSummary {
        format: bundle.format.clone(),
        exported_at_ms: bundle.exported_at_ms,
        app_version: bundle.app_version.clone(),
        device_id: bundle.device_id.clone(),
        tables,
        total_rows,
        compatible,
        message,
    }
}
