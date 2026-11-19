//! 应用使用统计的服务层（0.13.0，0.12.5 加时段明细，0.12.8 改成整天重算）。
//!
//! 三条职责，只碰 `app_usage` 与 `app_usage_span` 两张表：
//! 1. `rollup`：用桥回值**整天重算**（先清后写，不是累加也不是取大 —— 见下）。
//! 2. `read`：读某一天的排行，并把时段按包挂回每一行。
//! 3. `merge_spans`：把区间排序、合并重叠/相接/**一分钟内的空隙** —— 读出来和写进去
//!    用同一份，不许两处各写一遍。
//!
//! **为什么是整天重算**：`rows` 与 `spans` 现在是同源派生的（总量 = 那天所有段之和，
//! 见 `native/UsageStats.kt`），重扫一天就是对那一天重新做一次完整的推导，而不是在一个
//! 单调累加的系统计数器上「再往上抬一点」。取 MAX 在 0.12.8 会直接把修复吃掉：旧算法写
//! 下的虚高值（系统日桶跨天，实测某游戏 5 小时 12 分、某天合计 14 小时）永远降不下来，
//! 因为 MAX 只升不降 —— 界面上于是出现「合计 5 小时 12 分 / 只有 3 段 25 分钟」。
//!
//! **唯一例外**：桥对这一天什么也没回（`rows` 与 `spans` 都是空，即明细已被系统回收）时
//! **一个字节都不动**。否则打开一个 7 天前的日期就会把库里的历史清空 —— 那种清空是数据
//! 丢失，与「重算」不是一回事。
//!
//! ## 时段为什么也要落库
//! 「9:00-9:30、10:00-10:10」这种明细只有系统事件流里有，而**系统只留约 7 天**。
//! `app_usage` 当初存在的理由（0008 的注释）在这里原样成立：不落库，第 8 天起
//! 这段历史就永久消失，界面上只剩一个「一共用了 40 分钟」的数字。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::usage::{UsageAggregate, UsageAppDto, UsageRowDto, UsageSpan, UsageSpanRowDto};

/// 用桥回值**整天重算**某一天的聚合与时段。
///
/// 空回值是合法输入，但含义特殊：那天一个应用都没用，或者系统已经把明细回收
/// （7 天前的日期）。这两种情况从数据上分不开，所以**一律不动库**，宁可留着旧记录
/// 也不要静默清空。`rows` 与 `spans` 在**同一个事务**里先清后写：只写进聚合、段没写进，
/// 界面就会「有 40 分钟但没有一个时段」，而没有任何报错。
///
/// 桌面目标上唯一的调用方（`commands::usage_cmd::usage_stats_get`）在 `#[cfg(mobile)]`
/// 分支里，桌面那条分支直接回 `supported: false`。**不整段 `cfg` 掉**：一旦 `cfg` 掉，
/// 这个函数就永远只在手机包里有，桌面 `cargo test` 编不到它，下一个人重构时编译器
/// 也不提醒他调用点已经断了（`services::overlay_push` 同款口径）。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn rollup(
    pool: &SqlitePool,
    date: &str,
    rows: &[UsageRowDto],
    spans: &[UsageSpanRowDto],
) -> AppResult<()> {
    /* 判据必须在 DELETE 之前：这一天系统什么都不知道 ⇒ 保住库里已有的历史。 */
    if rows.is_empty() && spans.is_empty() {
        return Ok(());
    }
    let now = crate::platform::clock::now_ms();
    let mut tx = pool.begin().await?;
    /* 先清后写：重扫一天等于对那一天重新推导一次。取大/累加都会让旧算法的虚高值
    永远降不下来（见模块注释）。两条 DELETE 与下面的 INSERT 在同一个事务里，
    中间没有「库里空了一天」的窗口能被别的读命令看到。 */
    sqlx::query("DELETE FROM app_usage WHERE local_date = ?1")
        .bind(date)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM app_usage_span WHERE local_date = ?1")
        .bind(date)
        .execute(&mut *tx)
        .await?;
    for row in rows {
        if row.package_name.is_empty() || row.sec <= 0 {
            continue;
        }
        /* `ON CONFLICT` 只为兜「同一批里重复出现同一个包」这种畸形输入：
        表已经清空，正常的桥回值不会撞主键。撞了就取大，不让整页报错。 */
        sqlx::query(
            r#"
            INSERT INTO app_usage
                (package_name, local_date, foreground_sec, first_seen_at, last_seen_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(package_name, local_date) DO UPDATE SET
                foreground_sec = MAX(app_usage.foreground_sec, excluded.foreground_sec),
                first_seen_at  = CASE
                    WHEN app_usage.first_seen_at = 0 THEN excluded.first_seen_at
                    WHEN excluded.first_seen_at = 0 THEN app_usage.first_seen_at
                    ELSE MIN(app_usage.first_seen_at, excluded.first_seen_at)
                END,
                last_seen_at   = MAX(app_usage.last_seen_at, excluded.last_seen_at),
                updated_at     = excluded.updated_at
            "#,
        )
        .bind(&row.package_name)
        .bind(date)
        .bind(row.sec)
        .bind(row.first)
        .bind(row.last)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    /* 时段：同一批理论上一段一行。真撞上同一个起点（畸形输入）就取更长的一侧 ——
    短的那条必然是裁剪产物，没有信息量。 */
    for span in spans {
        if span.package_name.is_empty() || span.to <= span.from {
            continue;
        }
        sqlx::query(
            r#"
            INSERT INTO app_usage_span
                (package_name, local_date, start_ms, end_ms, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(package_name, local_date, start_ms) DO UPDATE SET
                end_ms     = MAX(app_usage_span.end_ms, excluded.end_ms),
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&span.package_name)
        .bind(date)
        .bind(span.from)
        .bind(span.to)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// 读某一天的排行（按时长降序），每行带上这天的时段。
///
/// 与 `rollup` 同一处境：唯一调用点在 `usage_stats_get` 的 `#[cfg(mobile)]` 分支，
/// 桌面不读这张表。**不 `cfg` 掉**，理由同上：桌面 `cargo test` 要能编到它，
/// 纯 SQL 逻辑才不会只在手机包上被验证。
///
/// 时段**从库里读**，不从桥回值直接透传：老日期桥那边已经什么都不回了，
/// 但库里还留着当时记下的段 —— 与 `packages()` 给老日期补真名是同一条思路。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn read(pool: &SqlitePool, date: &str) -> AppResult<Vec<UsageAggregate>> {
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        r#"
        SELECT package_name, foreground_sec, first_seen_at, last_seen_at
        FROM app_usage
        WHERE local_date = ?1
        ORDER BY foreground_sec DESC, package_name ASC
        "#,
    )
    .bind(date)
    .fetch_all(pool)
    .await?;

    let span_rows: Vec<(String, i64, i64)> = sqlx::query_as(
        r#"
        SELECT package_name, start_ms, end_ms
        FROM app_usage_span
        WHERE local_date = ?1
        ORDER BY package_name ASC, start_ms ASC
        "#,
    )
    .bind(date)
    .fetch_all(pool)
    .await?;

    let mut by_package: std::collections::HashMap<String, Vec<UsageSpan>> =
        std::collections::HashMap::new();
    for (package_name, from, to) in span_rows {
        if to <= from {
            continue;
        }
        by_package
            .entry(package_name)
            .or_default()
            .push(UsageSpan { from, to });
    }

    Ok(rows
        .into_iter()
        .map(|(package_name, sec, first, last)| {
            /* `merge_spans` 自己会排序：这里顺手拿走，缺键就是空数组，不造一个假段。 */
            let spans = by_package
                .remove(&package_name)
                .map(merge_spans)
                .unwrap_or_default();
            UsageAggregate {
                package_name,
                sec,
                first,
                last,
                /* 库里不存显示名（迁移 0008 的设计），这里先留空，由 `with_meta` 现查填上。 */
                label: String::new(),
                icon: String::new(),
                spans,
            }
        })
        .collect())
}

/// 排序 + 合并重叠、相接，以及**空隙 ≤ 1 分钟**的相邻区间。
///
/// 为什么必须有这一步：库里按 `start_ms` 去重，但**起点不同、内容重叠**的段会并存
/// （系统补报了更细的切换、或某次查询窗口不同），读出来直接画就会出现
/// 「09:00-09:30」紧跟「09:10-09:40」两条，加起来比实际时间还长。
///
/// 相接（`next.from == last.to`）也合并：中间没有任何别的应用或息屏，本来就是一整段。
///
/// **≤ 1 分钟的空隙也并入**（0.12.8，用户原话「不足一分钟的计时应忽略或自动合并」）：
/// 按配对键配出的段之间有几十毫秒（同应用换 Activity）到几十秒（回桌面秒回）的空隙，
/// 不并的话一次连续使用被切成一串「09:01-09:02」。只桥 ≤ 1 分钟：更长的空隙意味着
/// 用户真的离开了，把那段并进使用时长才是编造没发生过的事实。
///
/// 结果按时间升序，空段（`to <= from`）被丢掉。
#[cfg_attr(desktop, allow(dead_code))]
pub fn merge_spans(mut spans: Vec<UsageSpan>) -> Vec<UsageSpan> {
    const MERGE_GAP_MS: i64 = 60_000;
    spans.sort_by_key(|span| (span.from, span.to));
    let mut out: Vec<UsageSpan> = Vec::with_capacity(spans.len());
    for span in spans {
        if span.to <= span.from {
            continue;
        }
        match out.last_mut() {
            Some(last) if span.from <= last.to + MERGE_GAP_MS => {
                if span.to > last.to {
                    last.to = span.to;
                }
            }
            _ => out.push(span),
        }
    }
    out
}

/// 库里某一天出现过的包名。
///
/// **这一条是为了老日期**：系统只保留约 7 天明细，更早的日子 `queryDay` 回空，
/// 但库里那些行还在。把它们一并下传给桥，`PackageManager` 就能照样解析出
/// 「微信」而不是回落成「Mm」—— 名字与系统明细还在不在无关。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn packages(pool: &SqlitePool, date: &str) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT package_name
        FROM app_usage
        WHERE local_date = ?1 AND package_name <> ''
        ORDER BY foreground_sec DESC
        "#,
    )
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(name,)| name).collect())
}

/// 把桥回的展示元数据（名字 / 图标）合并进排行行。
///
/// 三条口径：
/// - **按包名精确匹配**，不做前缀/相似匹配 —— 「找到像的」比「没有」更坏。
/// - 合并不到（包已卸载、桥没给）留空串，前端只有一条回落规则（包名短名）。
/// - 只覆盖 `label` / `icon`，**不碰** `sec` / `first` / `last` / `spans`：事实与展示分开，
///   这里改错也不会把时长算歪、把时段弄丢。
#[cfg_attr(desktop, allow(dead_code))]
pub fn with_meta(rows: Vec<UsageAggregate>, apps: &[UsageAppDto]) -> Vec<UsageAggregate> {
    if apps.is_empty() {
        return rows;
    }
    let lookup: std::collections::HashMap<&str, &UsageAppDto> = apps
        .iter()
        .map(|app| (app.package_name.as_str(), app))
        .collect();
    rows.into_iter()
        .map(|mut row| {
            if let Some(app) = lookup.get(row.package_name.as_str()) {
                row.label = app.label.clone();
                row.icon = app.icon.clone();
            }
            row
        })
        .collect()
}
