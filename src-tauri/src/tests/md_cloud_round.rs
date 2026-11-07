//! 云端编排（V0.11.13，设计 §2.1 / §2.2 / §3.5）：分派、指纹、本地目录通道、队列三态。
//!
//! 断言口径都是**行为**：老配置与 `md_sync::run` 等价、指纹的确定值、目标目录里真的
//! 出现了今日文件、欠账时间不被刷新、缺密码时一个请求都不发。
//!
//! WebDAV 的真网络路径不在这里（`infra::md_webdav` 已用假服务器覆盖传输层，
//! `tests/md_webdav.rs`）；编排层用 LocalFolder 与「缺密码」两条路把判据走通。

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::infra::md_file;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::repositories::md_cloud_pending;
use crate::services::md_cloud::{self, pending};
use crate::services::md_sync::{self, config};
use crate::tests::md_sync::{binding, env, TIMERS_HEADING};
use crate::tests::support::{insert_saved, new_item, unique_dir};
use crate::{platform::clock::now_ms, services::md_sync::config::load};

/// 今日落点文件（`{date}.md`）的绝对路径。
fn vault_file(vault: &std::path::Path, date: chrono::NaiveDate) -> PathBuf {
    vault.join(format!("{}.md", date.format("%Y-%m-%d")))
}

fn same_report(left: &MdSyncReport, right: &MdSyncReport) -> bool {
    left.imported == right.imported
        && left.exported == right.exported
        && left.kinds == right.kinds
        && left.errors == right.errors
}

/// 验收第 6 条（老配置行为不变）的机器证据：`cloud = None` 时 `round` 与 `run` 逐项等价。
#[tokio::test]
async fn round_without_cloud_is_the_same_as_run() {
    let via_round = env("cloud-equiv-round").await;
    let via_run = env("cloud-equiv-run").await;

    /* 两个库造同一份数据：一条 10 分钟的已保存记录。
       `now` 必须在循环外只取一次：两次 `now_ms()` 若跨过秒/分界，两个库里的
       `started_at` / `ended_at` 会差一瞬，而 `md_sync::format` 把时间打进 md 正文，
       下面「两个入口写出的文件逐字相同」就会偶发红。`cloud=None` 时 `round` 直接调
       `md_sync::run`，两边是同一套渲染；本用例没有进行中的记录，`timers_at` 的 `now`
       不参与正文，所以数据一致即可逐字一致。 */
    let now = now_ms();
    for fixture in [&via_round, &via_run] {
        let item = new_item(&fixture.pool, "写作").await;
        insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;
    }

    let outcome = md_cloud::round(&via_round.pool)
        .await
        .expect("round 应成功");
    let report = md_sync::run(&via_run.pool).await.expect("run 应成功");

    assert!(
        same_report(&outcome.report, &report),
        "cloud=None 时 round 必须与 run 等价：{:?} vs {:?}",
        outcome.report,
        report
    );
    assert!(outcome.report.exported > 0, "三个落点都该被写出");
    assert!(outcome.pending.is_empty(), "老配置没有待传概念");
    assert_eq!(
        outcome.today,
        via_round.date.format("%Y-%m-%d").to_string(),
        "today 必须是本地日期的 yyyy-MM-dd"
    );

    let round_text = fs::read_to_string(vault_file(&via_round.vault, via_round.date)).unwrap();
    let run_text = fs::read_to_string(vault_file(&via_run.vault, via_run.date)).unwrap();
    assert_eq!(
        round_text, run_text,
        "两个入口写出的文件必须逐字相同（同一套渲染，不该有第二个结果）"
    );
    assert!(round_text.contains(TIMERS_HEADING));
}

/// FNV-1a 64 的确定值（自己算的，不是抄的）：空串 / 单字节 / 一段中文 / 带标题的一段。
#[test]
fn fnv1a64_vectors_are_pinned() {
    assert_eq!(pending::fingerprint(b""), "cbf29ce484222325");
    assert_eq!(pending::fingerprint(b"a"), "af63dc4c8601ec8c");
    assert_eq!(pending::fingerprint("中文".as_bytes()), "514dcc99d8cadec5");
    assert_eq!(
        pending::fingerprint(TIMERS_HEADING.as_bytes()),
        "a0d5b2cbce736f1f"
    );

    /* 形状也要钉住：16 位小写十六进制（SQL / 日志里看到的长相）。 */
    let hash = pending::fingerprint(b"2026-11-06");
    assert_eq!(hash.len(), 16);
    assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit() && !ch.is_uppercase()));
}

/// LocalFolder：跑一轮之后目标目录里真的出现今日文件，且内容含区块标题。
#[tokio::test]
async fn local_folder_round_writes_todays_file() {
    let fixture = env("cloud-folder").await;
    let cloud_dir = unique_dir("cloud-folder-target");
    let item = new_item(&fixture.pool, "读书").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 300_000, now, 300).await;

    let mut stored = load(&fixture.pool).await.expect("读配置应成功");
    stored.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: cloud_dir.display().to_string(),
        ..Default::default()
    });
    config::save(&fixture.pool, &stored)
        .await
        .expect("保存云端配置应成功");

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(outcome.report.errors.is_empty(), "{:?}", outcome.report.errors);
    assert!(outcome.pending.is_empty(), "LocalFolder 没有待传概念");

    let target = vault_file(&cloud_dir, fixture.date);
    let text = fs::read_to_string(&target).expect("云端目录里应出现今日文件");
    assert!(
        text.contains(TIMERS_HEADING),
        "云端那份必须带区块标题（与 Obsidian 那份结构相同）:\n{text}"
    );
    assert!(text.contains("读书"), "记录要出现在云端那份里");
    /* 两个落点各写一份：Obsidian 与云端目录都不该被对方顶掉。 */
    let vault_text = fs::read_to_string(vault_file(&fixture.vault, fixture.date)).unwrap();
    assert!(vault_text.contains(TIMERS_HEADING));
}

/// 队列三态（真编排里的第 ⑦ 步）：内容变 → 有欠账；再跑一次内容没变 → 欠账时间不刷新。
#[tokio::test]
async fn pending_only_moves_when_the_file_content_changes() {
    let fixture = env("cloud-pending").await;
    let first = 1_000i64;
    let later = 9_000i64;

    assert!(
        pending::record_if_changed(&fixture.pool, "2026-11-06", "第一版", first)
            .await
            .expect("记账应成功"),
        "第一次看到内容 → 必须记一笔"
    );
    let row = md_cloud_pending::get(&fixture.pool, "2026-11-06")
        .await
        .expect("查询应成功")
        .expect("应有行");
    assert_eq!(row.pending_since, first);
    assert_eq!(
        row.last_hash,
        Some(pending::fingerprint("第一版".as_bytes())),
        "落库的指纹必须与 `fingerprint` 同源"
    );

    assert!(
        !pending::record_if_changed(&fixture.pool, "2026-11-06", "第一版", later)
            .await
            .expect("记账应成功"),
        "内容没变 → 不该产生新欠账"
    );
    let row = md_cloud_pending::get(&fixture.pool, "2026-11-06")
        .await
        .expect("查询应成功")
        .expect("行应仍在");
    assert_eq!(row.pending_since, first, "没变化时连时间也不该动");

    assert!(
        pending::record_if_changed(&fixture.pool, "2026-11-06", "第二版", later)
            .await
            .expect("记账应成功"),
        "内容变了 → 再欠一笔"
    );
    let row = md_cloud_pending::get(&fixture.pool, "2026-11-06")
        .await
        .expect("查询应成功")
        .expect("行应仍在");
    assert_eq!(
        row.pending_since, first,
        "`pending_since` 记的是第一次发现有未传改动的时刻，第二次不许重置"
    );
    assert_eq!(
        row.last_hash,
        Some(pending::fingerprint("第二版".as_bytes())),
        "指纹要跟着最新内容走"
    );
}

/// 缺密码 → 有错误、且**一个网络请求都不发**。
///
/// 反证手法：`base_url` 指向一个必然不通的地址。真的发了请求就会走 10 秒连接超时并
/// 得到超时/连不上，本用例的两条断言（错误文案 + 用时）都会红。
#[tokio::test]
async fn webdav_without_a_secret_never_touches_the_network() {
    let fixture = env("cloud-nosecret").await;
    let mut stored = load(&fixture.pool).await.expect("读配置应成功");
    stored.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: "http://127.0.0.1:9/dav".into(),
        base_path: "/Timing/md".into(),
        user: "qa@example.com".into(),
        ..Default::default()
    });
    config::save(&fixture.pool, &stored)
        .await
        .expect("保存云端配置应成功");

    let started = Instant::now();
    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    let elapsed = started.elapsed();

    assert!(
        !outcome.report.errors.is_empty(),
        "缺密码必须给出明确错误，不能静默成功"
    );
    let detail = outcome.report.errors.join("；");
    assert!(
        detail.contains("凭据"),
        "原因要说清是「系统凭据拿不到」，实际：{detail}"
    );
    assert!(
        !detail.contains("超时") && !detail.contains("连不上"),
        "缺密码时不该发请求（否则错误会变成网络类）：{detail}"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "缺密码时不该等连接超时（实际 {elapsed:?}）"
    );
    /* 编排在取密码处就返回了：既没建云端落点目录，也没排欠账。 */
    assert!(
        md_cloud_pending::get(&fixture.pool, &outcome.today)
            .await
            .expect("查询应成功")
            .is_none(),
        "没发请求就不该产生欠账"
    );
    assert!(outcome.pending.is_empty());
    assert!(
        !md_file::resolve_path(
            crate::models::md_sync_cloud::MD_SYNC_CLOUD_ROOT,
            "{date}.md",
            fixture.date
        )
        .exists(),
        "没取到密码就不该把云端落点文件建出来"
    );
}

/// `check_paths` 就是模型校验的转发（不另写一份路径比对）：目录撞车要拦下。
#[test]
fn check_paths_reuses_the_model_validation() {
    let vault = unique_dir("cloud-check-vault");
    let config = crate::models::md_sync_config::MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: vec![binding(
            crate::models::md_sync::MdSyncKind::Timers,
            &vault,
            "{date}.md",
            TIMERS_HEADING,
        )],
        cloud: Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::LocalFolder,
            local_root: vault.display().to_string(),
            ..Default::default()
        }),
    };
    assert!(
        md_cloud::check_paths(&config).is_err(),
        "云端目录与落点目录相同必须被拒绝"
    );
    assert!(
        md_cloud::check_paths(&crate::models::md_sync_config::MdSyncConfig::default()).is_ok(),
        "没有云端配置时不该报错"
    );
}
