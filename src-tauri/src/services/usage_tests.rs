//! 应用使用统计服务层的**纯函数**判据（`with_meta` / `merge_spans`）。
//!
//! 从 `services/usage.rs` 里拆出来的：那个文件加上测试撞到 `check:size` 的 300 行上限；
//! 落库与读库那一组又在 `usage_rollup_tests.rs`（那边要开真库，这一组不需要）。
//! 这里的每一条都对应一类**零报错**的坏结果：
//! - 段没合并 ⇒ 两条时间交错的读数，加起来比合计还长；
//! - 合并时把真断开的段连起来 ⇒ 编出一段没发生过的使用；
//! - 空段不丢 ⇒ 一行「09:00-09:00」；
//! - `with_meta` 顺手改了时长/首末 ⇒ 时段与合计对不上。

use crate::models::usage::{UsageAggregate, UsageAppDto, UsageSpan};
use crate::services::usage::{merge_spans, with_meta};

fn row(package_name: &str, sec: i64) -> UsageAggregate {
    UsageAggregate {
        package_name: package_name.to_string(),
        sec,
        first: 1,
        last: 2,
        label: String::new(),
        icon: String::new(),
        spans: Vec::new(),
    }
}

fn app(package_name: &str, label: &str) -> UsageAppDto {
    UsageAppDto {
        package_name: package_name.to_string(),
        label: label.to_string(),
        icon: format!("data:image/webp;base64,{label}"),
    }
}

fn span(from: i64, to: i64) -> UsageSpan {
    UsageSpan { from, to }
}

/// 真名合并进来，且时长、首末、时段**一个都没被碰**。
#[test]
fn with_meta_fills_label_and_icon_only() {
    let mut base = row("com.tencent.mm", 600);
    base.spans = vec![span(10, 20)];
    let out = with_meta(vec![base], &[app("com.tencent.mm", "微信")]);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].label, "微信");
    assert_eq!(out[0].icon, "data:image/webp;base64,微信");
    assert_eq!(out[0].sec, 600);
    assert_eq!(out[0].first, 1);
    assert_eq!(out[0].last, 2);
    assert_eq!(out[0].spans, vec![span(10, 20)]);
}

/// 桥没给（包已卸载）⇒ 留空串，不许回落到包名 —— 回落是前端**唯一**一处的事。
#[test]
fn with_meta_leaves_unknown_packages_blank() {
    let out = with_meta(
        vec![row("com.gone.app", 60)],
        &[app("com.tencent.mm", "微信")],
    );
    assert_eq!(out[0].label, "");
    assert_eq!(out[0].icon, "");
}

/// 空 `apps` 直接原样返回：调用方不必先判空。
#[test]
fn with_meta_is_a_noop_without_apps() {
    let out = with_meta(vec![row("a.b", 1)], &[]);
    assert_eq!(out[0].package_name, "a.b");
    assert_eq!(out[0].label, "");
}

/// 乱序进来、首尾相接的两段合并成一段：中间没有别的应用，本来就是一整段。
#[test]
fn merge_spans_sorts_and_joins_touching() {
    let out = merge_spans(vec![span(200, 300), span(100, 200)]);
    assert_eq!(out, vec![span(100, 300)]);
}

/// 重叠段取并集，不是相加：09:00-09:30 与 09:10-09:40 ⇒ 09:00-09:40。
#[test]
fn merge_spans_unions_overlaps() {
    let out = merge_spans(vec![span(100, 200), span(150, 250)]);
    assert_eq!(out, vec![span(100, 250)]);
}

/// 被完全包含的段不会把已合并的区间改小。
#[test]
fn merge_spans_keeps_the_longer_end() {
    let out = merge_spans(vec![span(100, 400), span(150, 200)]);
    assert_eq!(out, vec![span(100, 400)]);
}

/// 真断开的两段必须分开：合并它们等于编一段没发生过的使用。
/// 判据值用毫秒级真数：100 秒的空隙 > 1 分钟容差。
#[test]
fn merge_spans_keeps_real_gaps() {
    let out = merge_spans(vec![span(100_000, 200_000), span(300_000, 400_000)]);
    assert_eq!(out, vec![span(100_000, 200_000), span(300_000, 400_000)]);
}

/// ≤ 1 分钟的空隙并入两端（0.12.8）：同应用换 Activity、回桌面秒回都会留下
/// 几十毫秒到几十秒的空隙，一次连续使用不该被切成一串「09:01-09:02」。
#[test]
fn merge_spans_bridges_sub_minute_gaps() {
    /* 59 秒的空隙并入 */
    let out = merge_spans(vec![span(100_000, 200_000), span(259_000, 400_000)]);
    assert_eq!(out, vec![span(100_000, 400_000)]);
    /* 恰好 1 分钟也在容差内（判据是 `from <= last.to + 60_000`） */
    let out = merge_spans(vec![span(100_000, 200_000), span(260_000, 400_000)]);
    assert_eq!(out, vec![span(100_000, 400_000)]);
    /* 链式：三段各自空隙都不超过 1 分钟，全部并成一段 */
    let out = merge_spans(vec![
        span(100_000, 200_000),
        span(250_000, 300_000),
        span(350_000, 500_000),
    ]);
    assert_eq!(out, vec![span(100_000, 500_000)]);
}

/// 空段与倒挂段丢掉，不产生「09:00-09:00」这种读数。
#[test]
fn merge_spans_drops_degenerate_spans() {
    let out = merge_spans(vec![span(100, 100), span(300, 200), span(500, 600)]);
    assert_eq!(out, vec![span(500, 600)]);
}

/// 空输入回空 —— 老日期的正常状态，调用方不必先判空。
#[test]
fn merge_spans_is_empty_for_empty() {
    assert!(merge_spans(Vec::new()).is_empty());
}
