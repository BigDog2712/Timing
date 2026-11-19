//! `rollup` / `read` 的判据（从 `usage_tests.rs` 拆出来的：那边加上这一组撞
//! `check:size` 的 300 行上限，边界也清楚 —— 那边管纯函数，这边管落库与读库）。
//!
//! 每条都对应一类**零报错**的坏结果：
//! - 写了但读不到 ⇒ 界面「有 40 分钟，一个时段都没有」；
//! - 段没合并 ⇒ 两条时间交错的读数，加起来比合计还长；
//! - 段跨日期串了 ⇒ 昨天的时间显示在今天头上；
//! - 重扫取 MAX ⇒ 旧算法的虚高值永远降不下来（0.12.8 用户实测）。

use sqlx::SqlitePool;

use crate::models::usage::{UsageRowDto, UsageSpan, UsageSpanRowDto};
use crate::services::usage::{read, rollup};

fn span(from: i64, to: i64) -> UsageSpan {
    UsageSpan { from, to }
}

fn usage_row(package_name: &str, sec: i64, first: i64, last: i64) -> UsageRowDto {
    UsageRowDto {
        package_name: package_name.to_string(),
        sec,
        first,
        last,
    }
}

fn span_row(package_name: &str, from: i64, to: i64) -> UsageSpanRowDto {
    UsageSpanRowDto {
        package_name: package_name.to_string(),
        from,
        to,
    }
}

/// 端到端：`rollup` 写进去的段，`read` 必须原样挂在对应包的行上。
///
/// 这条钉的是「写了但读不到」——那正是本项目最贵的一类缺陷：聚合秒数上去了、
/// 界面上却一个时段都没有，零报错、测试全绿（`app_usage` 当初 0 行就是这么瞎的）。
#[test]
fn rollup_persists_spans_and_read_attaches_them_per_package() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        rollup(
            &pool,
            "2026-11-15",
            &[usage_row("com.tencent.mm", 600, 100_000, 400_000)],
            &[
                span_row("com.tencent.mm", 100_000, 200_000),
                span_row("com.tencent.mm", 300_000, 400_000),
            ],
        )
        .await
        .unwrap();

        let out = read(&pool, "2026-11-15").await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].package_name, "com.tencent.mm");
        /* 两段之间留了 100 秒的真断开（> 1 分钟容差），所以读回来还是两段 */
        assert_eq!(
            out[0].spans,
            vec![span(100_000, 200_000), span(300_000, 400_000)]
        );
    });
}

/// 重叠段在库里各自成行（主键是 start_ms），读出来必须并成一段：
/// 不并的话界面上会出现两条时间交错的读数，加起来比合计还长。
#[test]
fn read_merges_overlapping_spans_instead_of_stacking_them() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        rollup(
            &pool,
            "2026-11-15",
            &[usage_row("com.tencent.mm", 600, 100, 260)],
            &[
                span_row("com.tencent.mm", 100, 200),
                span_row("com.tencent.mm", 150, 260),
            ],
        )
        .await
        .unwrap();

        let out = read(&pool, "2026-11-15").await.unwrap();
        assert_eq!(out[0].spans, vec![span(100, 260)]);
    });
}

/// 重扫一天 = **整天重算**，不是「取大」。
///
/// 这条钉的是 0.12.8 用户实测的那个矛盾：旧算法把系统跨天日桶当总量，写下「王者荣耀
/// 5 小时 12 分」「某天合计 14 小时」。写入要是取 MAX，正确的 25 分钟永远盖不回去 ——
/// 界面上就是「合计 5 小时 12 分 / 只有 3 段 25 分钟」，用户只会得到一个结论：算错了。
/// 所以这里必须同时验证三件事：旧值降得下来、旧段消失了、没再出现的包整行消失。
#[test]
fn rollup_replaces_the_whole_day_instead_of_taking_max() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        /* 旧算法留下的那一天：虚高的合计 + 碎段 + 一个这一轮已经不存在的包 */
        rollup(
            &pool,
            "2026-11-14",
            &[
                usage_row("com.tencent.tmgp.sgame", 18_720, 100_000, 900_000),
                usage_row("com.tencent.mm", 30_000, 100_000, 900_000),
            ],
            &[
                span_row("com.tencent.tmgp.sgame", 100_000, 200_000),
                span_row("com.tencent.tmgp.sgame", 250_000, 260_000),
            ],
        )
        .await
        .unwrap();
        /* 新口径重扫：同一个包里只剩 25 分钟、两段（间隅 70 秒的真断开），
        另一个包这一轮没出现 */
        rollup(
            &pool,
            "2026-11-14",
            &[usage_row("com.tencent.tmgp.sgame", 1_500, 300_000, 480_000)],
            &[
                span_row("com.tencent.tmgp.sgame", 300_000, 360_000),
                span_row("com.tencent.tmgp.sgame", 430_000, 480_000),
            ],
        )
        .await
        .unwrap();

        let out = read(&pool, "2026-11-14").await.unwrap();
        assert_eq!(out.len(), 1, "没再出现的包整行该消失，而不是留着旧值");
        assert_eq!(out[0].sec, 1_500, "旧算法写下的虚高值必须能降下来");
        assert_eq!(
            out[0].spans,
            vec![span(300_000, 360_000), span(430_000, 480_000)]
        );
    });
}

/// 桥对这一天什么也没回（7 天前，明细已被系统回收）⇒ **一个字节都不动**。
///
/// 清空与重算是两件事：这里要是跟着 DELETE，用户翻到老日期就把自己的历史抹了。
#[test]
fn rollup_keeps_the_stored_day_when_the_bridge_returns_nothing() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        rollup(
            &pool,
            "2026-11-01",
            &[usage_row("com.tencent.mm", 600, 10, 20)],
            &[span_row("com.tencent.mm", 10, 20)],
        )
        .await
        .unwrap();
        rollup(&pool, "2026-11-01", &[], &[]).await.unwrap();

        let out = read(&pool, "2026-11-01").await.unwrap();
        assert_eq!(out.len(), 1, "系统没回值不该把库里的历史清掉");
        assert_eq!(out[0].sec, 600);
        assert_eq!(out[0].spans, vec![span(10, 20)]);
    });
}

/// 段按日期隔离：昨天的段不许挂到今天头上（界面上会显示昨天的时间）。
#[test]
fn read_does_not_leak_spans_across_dates() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        rollup(
            &pool,
            "2026-11-14",
            &[usage_row("com.tencent.mm", 60, 10, 20)],
            &[span_row("com.tencent.mm", 10, 20)],
        )
        .await
        .unwrap();
        rollup(
            &pool,
            "2026-11-15",
            &[usage_row("com.tencent.mm", 90, 30, 40)],
            &[span_row("com.tencent.mm", 30, 40)],
        )
        .await
        .unwrap();

        let out = read(&pool, "2026-11-15").await.unwrap();
        assert_eq!(out[0].spans, vec![span(30, 40)]);
        assert_eq!(out[0].sec, 90);
    });
}

/// 空段（`to <= from`）写库前就丢掉：不丢的话读出来是一行「09:00-09:00」。
#[test]
fn rollup_drops_degenerate_spans() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();

        rollup(
            &pool,
            "2026-11-15",
            &[usage_row("com.tencent.mm", 60, 10, 20)],
            &[
                span_row("com.tencent.mm", 10, 10),
                span_row("com.tencent.mm", 30, 20),
            ],
        )
        .await
        .unwrap();

        let out = read(&pool, "2026-11-15").await.unwrap();
        assert!(out[0].spans.is_empty(), "空段/倒挂段不该落库");
    });
}
