//! [QA 独立复验 V0.11.19 批 1] 自己补的 2 条最缺边界用例（跑完保留）。
//!
//! ## 为什么补这两条（与工程师 19 条不重复）
//!
//! `tests/md_cloud_tier.rs` + `tests/md_sync_wake.rs` 覆盖了三档的各条正向判据，但全是
//! **纯时钟帧**或 **LF 纯文本**：没有一条同时踩中下面两格。
//!
//! 1. **等号边界**：`covered` 的 `>=` 写成 `>` 会怎样？Max 的「期间有写」反例是什么？
//!    连败节流在「差 1 秒 / 刚好等于」两帧上是否对称？`>=` 与 `>` 的差别只有
//!    「成功轮与最后一笔写落在同一毫秒」这一格能观察到，工程师的
//!    `a_covered_idle_window_does_not_repeat` 用的是 400s > 300s，改坏也照样绿。
//!    另外老配置 `pollSecs=180` 反序列化后 `auto` 仍为 `None`、档位仍是「智能 + 15」，
//!    这条把「不从 pollSecs 反推档位」变成可执行断言，而不是读代码看一眼。
//! 2. **BOM + CRLF 真实文件走 `FileWatch::probe`**：上一轮 T01 放行的 K-1 条件要求
//!    「写前去抖 + 内容/mtime 复核」。工程师的 `file_probe_checks_the_fingerprint_not_just_mtime`
//!    只用 `b"first"` / `b"other"` 纯 ASCII，没碰 Windows 版 Obsidian 常态的
//!    UTF-8 BOM + CRLF，也没验「外部把 CRLF 归一成 LF」这种字节改动会不会被吞掉。
//!
//! 两条各自是本轮两条变异自检的靶子（见验收报告 §6）。

use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use chrono::NaiveDate;

use crate::infra::md_file;
use crate::jobs::md_cloud::{decide, TierReason, TierState};
use crate::jobs::md_sync::FileWatch;
use crate::models::constants::{
    MD_CLOUD_INTERVAL_DEFAULT_MINUTES, MD_CLOUD_INTERVAL_MAX_MINUTES,
    MD_CLOUD_INTERVAL_MIN_MINUTES, MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_STARTUP_DELAY_SECS,
};
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::models::md_sync_config::MdSyncConfig;
use crate::tests::support::unique_dir;

const SEC: i64 = 1_000;

fn tier(startup_ms: i64, startup_done: bool) -> TierState {
    TierState {
        startup_ms,
        startup_done,
        last_attempt_ms: None,
        last_success_ms: None,
    }
}

/// 三档状态机的等号边界帧：**差 1 秒 / 刚好等于**逐格钉住。
///
/// 变异 A 的靶子在「帧组 4」：把 `covered` 的 `ok >= last_write_ms` 改成 `>`，
/// 只有「成功轮与最后一笔写同毫秒」这一帧会红。
#[test]
fn qa_edge_three_tier_boundary_frames() {
    /* ---- 帧组 0：默认智能、不从 pollSecs 反推、老配置不多写一个键 ---- */
    let raw = r#"{"enabled":true,"pollSecs":180,"bindings":[],"cloud":{"enabled":true,"mode":"webdav","localRoot":"","baseUrl":"u","basePath":"/p","user":"me"}}"#;
    let config: MdSyncConfig = serde_json::from_str(raw).expect("老配置必须能解析");
    assert_eq!(config.poll_secs, 180, "老用户手填的 180 秒不能被改掉");
    let cloud = config.cloud.as_ref().expect("cloud 存在");
    assert!(cloud.auto.is_none(), "老配置不该被补出 auto 键");
    let auto = cloud.auto.clone().unwrap_or_default();
    assert_eq!(
        auto.schedule,
        CloudSchedule::Smart,
        "默认智能：不许从 180 秒反推出谁都没选过的「定时 3 分钟」"
    );
    assert_eq!(auto.interval_minutes, MD_CLOUD_INTERVAL_DEFAULT_MINUTES);
    assert_eq!(auto.interval_minutes, 15, "不是 3、不是 180/60，是独立的 15");
    assert_eq!(
        serde_json::to_string(&config).expect("序列化"),
        raw,
        "一次「什么都没改的保存」不许凭空多写 auto 键（放行条件 ③）"
    );

    /* ---- 帧组 1：定时档夹值 5–120（试 4 和 121）+ 切档不重置 30 ---- */
    assert_eq!(
        MdCloudAuto { interval_minutes: 4, ..Default::default() }.clamped_minutes(),
        MD_CLOUD_INTERVAL_MIN_MINUTES,
        "4 分钟要夹到 5"
    );
    assert_eq!(
        MdCloudAuto { interval_minutes: 121, ..Default::default() }.clamped_minutes(),
        MD_CLOUD_INTERVAL_MAX_MINUTES,
        "121 分钟要夹到 120"
    );
    let interval30 = MdCloudAuto {
        schedule: CloudSchedule::Interval,
        interval_minutes: 30,
    };
    let smart = MdCloudAuto {
        schedule: CloudSchedule::Smart,
        ..interval30.clone()
    };
    let back = MdCloudAuto {
        schedule: CloudSchedule::Interval,
        ..smart
    };
    assert_eq!(back.interval_minutes, 30, "定时 30 → 智能 → 定时仍是 30（H-2）");
    assert_eq!(back.interval_secs(), 30 * 60);

    /* ---- 帧组 2：启动轮 59 / 60，且只跑一次 ---- */
    let startup = tier(0, false);
    assert_eq!(decide(&startup, CloudSchedule::Smart, 900, 59 * SEC, 0), None);
    assert_eq!(
        decide(&startup, CloudSchedule::Smart, 900, MD_CLOUD_STARTUP_DELAY_SECS as i64 * SEC, 0),
        Some(TierReason::Startup),
        "刚好 60s 才跑"
    );
    let after_startup = tier(0, true);
    assert_eq!(
        decide(&after_startup, CloudSchedule::Smart, 900, 60 * SEC, 0),
        None,
        "startup_done 之后不许再补一次启动轮"
    );

    /* ---- 帧组 3：智能 idle 299 / 300 ---- */
    let write_at: i64 = 1_000 * SEC;
    let idle_state = tier(0, true);
    assert_eq!(
        decide(&idle_state, CloudSchedule::Smart, 900, write_at + 299 * SEC, write_at),
        None,
        "差 1 秒不许抢跑"
    );
    assert_eq!(
        decide(
            &idle_state,
            CloudSchedule::Smart,
            900,
            write_at + MD_CLOUD_SMART_IDLE_SECS as i64 * SEC,
            write_at,
        ),
        Some(TierReason::Idle),
        "刚好 300s 才跑"
    );

    /* ---- 帧组 4：covered 的等号边界（变异 A 靶子）---- */
    let mut settled = tier(0, true);
    settled.last_success_ms = Some(write_at); /* 成功轮与最后一笔写**同一毫秒** */
    assert_eq!(
        decide(&settled, CloudSchedule::Smart, 900, write_at + 300 * SEC, write_at),
        None,
        "账已结清：`ok >= last_write` 必须含等号，改成 `>` 会在这一帧红"
    );
    let mut not_settled = tier(0, true);
    not_settled.last_success_ms = Some(write_at - 1); /* 写发生在成功轮之后 1ms */
    assert_eq!(
        decide(&not_settled, CloudSchedule::Smart, 900, write_at + 300 * SEC, write_at),
        Some(TierReason::Idle),
        "新写的那笔没被覆盖，仍要传一次"
    );

    /* ---- 帧组 5：Max 1799 / 1800 + 「期间有写」的反例 ---- */
    let mut max_state = tier(0, true);
    max_state.last_success_ms = Some(0);
    assert_eq!(
        decide(&max_state, CloudSchedule::Smart, 900, 1_799 * SEC, 1_700 * SEC),
        None,
        "距上次成功 1799s 差 1 秒，不许抢跑"
    );
    assert_eq!(
        decide(&max_state, CloudSchedule::Smart, 900, 1_800 * SEC, 1_700 * SEC),
        Some(TierReason::Max),
        "刚好 1800s 且期间有写 → Max 兜底"
    );
    let mut no_new_write = tier(0, true);
    no_new_write.last_success_ms = Some(600 * SEC);
    assert_eq!(
        decide(&no_new_write, CloudSchedule::Smart, 900, 2_400 * SEC, 300 * SEC),
        None,
        "最后一笔写在成功轮之前、30 分钟里没有新写 → 不许空跑一轮上传"
    );

    /* ---- 帧组 6：云端连败节流，不许每秒重发 ---- */
    let mut failing = tier(0, true);
    failing.last_attempt_ms = Some(1_190 * SEC); /* 刚失败过一轮，没有 last_success */
    let last_write = 900 * SEC;
    assert_eq!(decide(&failing, CloudSchedule::Smart, 900, 1_200 * SEC, last_write), None);
    assert_eq!(
        decide(&failing, CloudSchedule::Smart, 900, 1_489 * SEC, last_write),
        None,
        "距上一轮 299s 仍不许重发"
    );
    assert_eq!(
        decide(&failing, CloudSchedule::Smart, 900, 1_490 * SEC, last_write),
        Some(TierReason::Idle),
        "满 300s 才允许再试一次"
    );
}

/// 写一帧并把 mtime 钉到指定整数秒，返回**实际** mtime 供夹具自检。
///
/// `probe` 的 `(mtime, len)` 快速路径意味着：若两帧 mtime 相同，内容比较根本不会发生，
/// 用例会退化成恒真的空跑。所以每帧都返回 mtime，由用例断言它真的变了。
fn write_stamped(path: &Path, bytes: &[u8], secs: u64) -> i64 {
    fs::write(path, bytes).expect("写文件");
    let at = UNIX_EPOCH + Duration::from_secs(secs);
    let times = fs::FileTimes::new().set_modified(at);
    let applied = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.set_times(times))
        .is_ok();
    if !applied {
        std::thread::sleep(Duration::from_millis(20));
    }
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |span| span.as_millis() as i64)
}

/// BOM + CRLF 的真实文件走 `FileWatch::probe`：**内容/mtime 两步复核**在 Windows
/// 输入形状上仍成立，且外部把 CRLF 改成 LF 不算「同一份内容」。
///
/// 变异 B 的靶子在「第 3 帧」：若指纹计算前先把 `\r` 剥掉（看起来像合理的健壮性
/// 优化），CRLF ↔ LF 的外部改动会被吞掉 —— 只有这一帧会红。
#[test]
fn qa_edge_bom_crlf_external_change_fingerprint() {
    let dir = unique_dir("qa-b1-bom-crlf");
    fs::create_dir_all(&dir).expect("建临时目录");
    let date = NaiveDate::from_ymd_opt(2026, 11, 7).expect("合法日期");
    let binding = MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: dir.to_string_lossy().into_owned(),
        file: "{date}.md".to_string(),
        heading: "#### 事项计时".to_string(),
    };
    let path = md_file::resolve_path(&binding.root, &binding.file, date);

    /* U+FEFF 在 UTF-8 里就是 EF BB BF；正文用中文，确认指纹对非 ASCII 字节同样敏感。 */
    let crlf = "\u{FEFF}#### 事项计时\r\n09:00:00\r\n";
    let touched = crlf; /* 逐字节相同，只推 mtime */
    let lf_version = "\u{FEFF}#### 事项计时\n09:00:00\n"; /* 外部把 CRLF 归一成 LF */
    let changed = "\u{FEFF}#### 事项计时\r\n09:00:00\r\n10:00:00\r\n"; /* 内容真变 */

    let mut watch = FileWatch::default();
    let one = write_stamped(&path, crlf.as_bytes(), 1_700_000_000);
    assert!(
        !watch.probe(std::slice::from_ref(&binding), date),
        "第一次观测只记基线，BOM/CRLF 不算外部改动"
    );

    let two = write_stamped(&path, touched.as_bytes(), 1_700_000_001);
    assert_ne!(two, one, "夹具自检：mtime 必须真的变了，否则 probe 会走快速路径跳过内容比较");
    assert!(
        !watch.probe(std::slice::from_ref(&binding), date),
        "touch / 无改动保存只推 mtime，BOM+CRLF 字节未变 → 不算外部改动（K-1 条件）"
    );

    let three = write_stamped(&path, lf_version.as_bytes(), 1_700_000_002);
    assert_ne!(three, two, "夹具自检：mtime 必须真的变了");
    assert!(
        watch.probe(std::slice::from_ref(&binding), date),
        "外部把 CRLF 改成 LF 是字节改动，必须被看到；指纹前不许先归一换行"
    );

    let four = write_stamped(&path, changed.as_bytes(), 1_700_000_003);
    assert_ne!(four, three, "夹具自检：mtime 必须真的变了");
    assert!(
        watch.probe(std::slice::from_ref(&binding), date),
        "正文真加了一行，必须被看到"
    );

    fs::remove_dir_all(&dir).ok();
}
