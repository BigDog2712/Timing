//! 冷启动埋点的纯函数（T17）：百分位口径与历史解析。
//!
//! 只测算术，不测文件 I/O——写文件的路径在 `bootstrap` 里，靠日志人工核对即可。

use crate::platform::boot_timing::{parse_history, percentile, summarize, Sample};

#[test]
fn percentile_uses_nearest_rank_not_interpolation() {
    let v = [10u64, 20, 30, 40, 50];
    // 最近秩：P50 → ceil(0.5*5)=3 → 第 3 个（30），不是插值的 30.0 巧合
    assert_eq!(percentile(&v, 50), 30);
    // P95 → ceil(0.95*5)=5 → 最后一个
    assert_eq!(percentile(&v, 95), 50);
    // P1 → ceil(0.01*5)=1 → 第一个
    assert_eq!(percentile(&v, 1), 10);
}

#[test]
fn percentile_edge_cases() {
    assert_eq!(percentile(&[], 50), 0, "空集合必须是 0，不能 panic");
    assert_eq!(percentile(&[7], 50), 7);
    assert_eq!(percentile(&[7], 95), 7);
    assert_eq!(percentile(&[7], 100), 7);
    // p 越界被钳制
    assert_eq!(percentile(&[1, 2, 3], 0), 1);
    assert_eq!(percentile(&[1, 2, 3], 255), 3);
}

#[test]
fn percentile_sensitivity_needs_more_than_one_bad_run() {
    // 最近秩 P95 的含义就是「95% 的样本不高于它」。20 个样本时 P95 = 第 19 个，
    // 所以**单个**离群值不会把 P95 抬起来（这里刻意钉住这个「反直觉但正确」的行为，
    // 免得以后有人以为 P95 没动就等于没退化）：
    let mut one_outlier: Vec<u64> = vec![100; 19];
    one_outlier.push(400);
    one_outlier.sort_unstable();
    assert_eq!(
        percentile(&one_outlier, 95),
        100,
        "1/20 的离群值落在 P95 之上"
    );

    // 两个离群值（2/20 = 10% > 5%）就会进入 P95：
    let mut two_outliers: Vec<u64> = vec![100; 18];
    two_outliers.extend([400, 400]);
    two_outliers.sort_unstable();
    assert_eq!(percentile(&two_outliers, 95), 400);
}

#[test]
fn summarize_window_of_30_hides_a_single_slow_run() {
    // 30 条里只有 1 条 900ms：P95 = 第 29 个 → 仍是 100ms。
    // 这是 P95 的定义使然（5% × 30 = 1.5，允许 1 条落在其之上），
    // 排查退化时应当同时看日志里的单次 trail，不能只看 P95。
    let mut samples: Vec<Sample> = (0..29)
        .map(|_| Sample {
            setup_ms: 100,
            show_ms: 200,
        })
        .collect();
    samples.push(Sample {
        setup_ms: 900,
        show_ms: 200,
    });
    let (s50, s95, _, _, n) = summarize(&samples, 30);
    assert_eq!(n, 30);
    assert_eq!(s50, 100);
    assert_eq!(s95, 100);
}

#[test]
fn parse_history_skips_garbage() {
    let text = "# 注释行\n\n120\t240\t2026-10-18 09:00\nbroken\n300\t\t2026-10-18 09:01\n450\t0\t2026-10-18 09:02\n";
    let s = parse_history(text);
    assert_eq!(s.len(), 2, "只有第 1、4 行是合法样本");
    assert_eq!(
        s[0],
        Sample {
            setup_ms: 120,
            show_ms: 240
        }
    );
    assert_eq!(
        s[1],
        Sample {
            setup_ms: 450,
            show_ms: 0
        }
    );
}

#[test]
fn parse_history_accepts_two_column_lines() {
    // setup 写完、首帧还没来的中间态只有两列
    let s = parse_history("180\t0\n");
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].setup_ms, 180);
}

#[test]
fn summarize_only_counts_last_window() {
    // 40 条历史，前 10 条是 9999ms 的远古慢样本，窗口 30 应把它们排除
    let mut samples: Vec<Sample> = (0..10)
        .map(|_| Sample {
            setup_ms: 9999,
            show_ms: 9999,
        })
        .collect();
    samples.extend((0..30).map(|_| Sample {
        setup_ms: 100,
        show_ms: 200,
    }));
    let (s50, s95, f50, f95, n) = summarize(&samples, 30);
    assert_eq!(n, 30, "只取最后 30 条");
    assert_eq!(s50, 100);
    assert_eq!(s95, 100);
    assert_eq!(f50, 200);
    assert_eq!(f95, 200);
}

#[test]
fn summarize_ignores_unobserved_first_frame() {
    // show_ms = 0 表示「那次没观测到首帧」，不能当成 0ms 拉低 P50
    let samples = [
        Sample {
            setup_ms: 100,
            show_ms: 0,
        },
        Sample {
            setup_ms: 110,
            show_ms: 300,
        },
        Sample {
            setup_ms: 120,
            show_ms: 340,
        },
    ];
    let (_, _, f50, f95, n) = summarize(&samples, 30);
    assert_eq!(n, 3);
    assert_eq!(f50, 300, "0 值被排除后中位数是 300");
    assert_eq!(f95, 340);
}

#[test]
fn summarize_all_unobserved_is_zero() {
    let samples = [Sample {
        setup_ms: 90,
        show_ms: 0,
    }];
    let (s50, s95, f50, f95, n) = summarize(&samples, 30);
    assert_eq!((s50, s95, f50, f95, n), (90, 90, 0, 0, 1));
}
