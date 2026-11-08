//! QA 独立验收｜T04 变更 A 的 **LocalFolder 半场**（V0.11.19，验收方自造，不复用工程师的机验）。
//!
//! 这里的每一条都回答同一件事：**把被测代码改坏，它会不会红**。所以每条都配了一个
//! 「反面对照」（该删的确实删了 / 该拒的确实整段没动手），避免「怎么都不删也算绿」。
//!
//! 与工程师那四份的区别（不重复造同一件事）：
//! - `i9b`：手工把水位改成 `2099-01-01`（验收方自造，不引用任何一条既有结论），
//!   并配一条对照轮证明「0 行」不是因为夹具本来就删不掉；
//! - `i9c`：**日期语义**用「换一个 `today` 入参」证明 —— `run_folder` 的 `today` 是入参
//!   不是自己取时钟，于是「昨天的今天」在下一轮变成往期后**确实被删**。这一格原先被判
//!   「做不出稳定夹具」，实际只需要把系统时钟挪进参数；
//! - `gate3_*`：闸③ 的**父子**方向走 `run_folder` 真实入口（工程师那条只造了「同一个目录」）；
//! - `gate5a_*`：名字合法但**没有 pending 行** → 不删（闸⑤ 的另一段证据）；
//! - `folder_is_not_paused_*`：WebDAV 通道连败暂停，folder 那一轮照删（分通道的硬约束）。
//!
//! 追责面（`md-cloud-purge.log` 真实落盘 + I16 格式）与 I9a 在 `qa_t04_audit_log.rs`。

use std::fs;

use crate::models::md_cloud_purge::{channel_key, PurgeChannel, PurgeKey, OVERLAP_TEXT, PurgeState};
use crate::repositories::settings;
use crate::services::md_cloud::{self, purge};
use crate::tests::md_cloud_purge::{binding_of, kv, list_names, seed_past, state_of};
use crate::tests::md_sync::env;
use crate::tests::qa_t04_audit_log::{audit_dir, audit_lines};
use crate::tests::support::unique_dir;


/// I9b（验收方自造）：手工把水位改成 `2099-01-01` —— 今天那份**仍然不删**。
#[tokio::test]
async fn i9b_a_watermark_poisoned_to_2099_never_removes_today() {
    /* 同 i9a：先注入日志目录。否则下面那条「日志 0 条 purge:」是**空断言** ——
       `log_dir()` 为 None 时 `append` 本来就什么都不写，绿了也证明不了任何事。 */
    let _ = audit_dir();
    let fixture = env("qa-t04-i9b").await;
    let root = unique_dir("qa-t04-i9b");
    seed_past(&fixture.pool, &root, "2018-04-05").await;
    let today = md_cloud::today();
    fs::write(root.join(format!("{today}.md")), "今天的日记").expect("写当天文件");
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Folder, PurgeKey::Upto),
        "2099-01-01",
        0,
    )
    .await
    .expect("手工把水位改成未来");

    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("清理不该返回错误");

    assert!(
        root.join(format!("{today}.md")).is_file(),
        "水位被改成 2099 也不许删今天那份（I9b）"
    );
    assert!(
        root.join("2018-04-05.md").is_file(),
        "整轮被未来水位短路：往期也没动（这一轮什么都不做才是安全的一侧）"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Upto)
            .await
            .as_deref(),
        Some("2099-01-01"),
        "被短路的这一轮不许改写水位"
    );
    /* I9b 的第三条判据：日志 0 条 purge:。追责面一行都没有 = 一条删除都没发生。 */
    assert!(
        !audit_lines()
            .iter()
            .any(|line| line.starts_with("2018-04-05")),
        "这一轮一条删除都不许发生"
    );

    /* **对照**：把水位清掉再跑一轮 —— 同一份往期立刻被删、追责面真的多出一行。
       没有这一段，上面那条「0 行」可能只是「这个夹具本来就删不掉」（闸⑤ 没证据之类），
       整条用例就是空跑。 */
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Folder, PurgeKey::Upto),
        "",
        0,
    )
    .await
    .expect("清掉水位");
    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("对照轮");
    assert!(
        !root.join("2018-04-05.md").exists(),
        "对照：水位清掉后它就该被删，否则上面那条 0 行证明不了任何事"
    );
    assert!(
        audit_lines()
            .iter()
            .any(|line| line.starts_with("2018-04-05")),
        "对照：追责面必须真的落下一行（证明这条路是通的）"
    );
    let _ = fs::remove_dir_all(&root);
}

/// I9c：**日期语义** —— 昨天的「今天」在下一轮变成往期后确实被删。
///
/// `run_folder` 的 `today` 是入参（不是自己取时钟），所以这一格不需要拨系统时钟：
/// 同一天跑一次什么都不删，把 `today` 推到次日再跑，那份「昨天的今天」就进了保留窗口外。
#[tokio::test]
async fn i9c_the_today_of_yesterday_becomes_purgeable_when_today_advances() {
    let fixture = env("qa-t04-i9c").await;
    let root = unique_dir("qa-t04-i9c");
    seed_past(&fixture.pool, &root, "2018-07-05").await;

    purge::run_folder(&fixture.pool, &root, &[], "2018-07-05")
        .await
        .expect("第一轮");
    assert!(
        root.join("2018-07-05.md").is_file(),
        "它就是那一天的「今天」，绝不删"
    );

    purge::run_folder(&fixture.pool, &root, &[], "2018-07-06")
        .await
        .expect("次日");
    assert!(
        !root.join("2018-07-05.md").exists(),
        "换日之后它就是往期了，必须删（I9c）"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 闸③ 的**父子**方向走真实入口：日记目录是云端目录的子目录 → 整段拒绝。
#[tokio::test]
async fn gate3_a_child_directory_binding_refuses_the_whole_round() {
    let fixture = env("qa-t04-gate3").await;
    let root = unique_dir("qa-t04-gate3");
    let child = root.join("daily");
    fs::create_dir_all(&child).expect("建子目录");
    for date in ["2018-08-05", "2018-08-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let before = list_names(&root);

    purge::run_folder(&fixture.pool, &root, &[binding_of(&child)], &md_cloud::today())
        .await
        .expect("闸③ 拒绝不是错误，是一条记账");

    assert_eq!(list_names(&root), before, "互为父子时一个文件都不许删");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Upto).await,
        None,
        "水位一动不动"
    );
    assert_eq!(
        state_of(&fixture.pool, PurgeChannel::Folder)
            .await
            .overlap_note,
        OVERLAP_TEXT,
        "红字逐字进 state（块④ 的红字位由它来）"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day)
            .await
            .as_deref(),
        Some(md_cloud::today().as_str()),
        "day 要写：今天不再试（用户改好配置后第二天自动恢复）"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 闸⑤(a)：名字合法但**没有 pending 行** → 不是我们写的，不删。
#[tokio::test]
async fn gate5a_a_strict_date_file_without_a_pending_row_is_never_deleted() {
    let fixture = env("qa-t04-gate5a").await;
    let root = unique_dir("qa-t04-gate5a");
    fs::create_dir_all(&root).expect("建云端目录");
    /* 用户自己的文件：名字完全合规，只是从来不是 Timing 写的。 */
    fs::write(root.join("2018-05-05.md"), "主人手写的日记").expect("写用户文件");
    seed_past(&fixture.pool, &root, "2018-05-06").await;

    purge::run_folder(&fixture.pool, &root, &[], &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    assert!(
        root.join("2018-05-05.md").is_file(),
        "没有证据的那份绝不能删（闸⑤-a）"
    );
    assert!(
        !root.join("2018-05-06.md").exists(),
        "有证据的那份必须删 —— 否则这条断言可能只是「怎么都不删」"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 六个 KV 键分通道：WebDAV 那条路连败暂停，**不该影响**没有认证的本地目录那条路。
#[tokio::test]
async fn folder_is_not_paused_by_the_webdav_channel() {
    let fixture = env("qa-t04-pause").await;
    let root = unique_dir("qa-t04-pause");
    seed_past(&fixture.pool, &root, "2018-09-05").await;
    let paused = PurgeState {
        paused: true,
        fail_days: 3,
        ..Default::default()
    };
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Webdav, PurgeKey::State),
        &serde_json::to_string(&paused).expect("序列化"),
        0,
    )
    .await
    .expect("把 webdav 通道写成暂停");

    purge::run_folder(&fixture.pool, &root, &[], &md_cloud::today())
        .await
        .expect("folder 通道不该被 webdav 的暂停带停");

    assert!(
        !root.join("2018-09-05.md").exists(),
        "共用一份 state 的话，这里会因为 webdav 的暂停而漏删"
    );
    assert!(
        state_of(&fixture.pool, PurgeChannel::Webdav).await.paused,
        "webdav 自己的暂停位不许被 folder 这一轮清掉"
    );
    let _ = fs::remove_dir_all(&root);
}
