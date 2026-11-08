//! QA 独立验收｜T04 变更 A 的**追责面**：`data/logs/md-cloud-purge.log`（设计 §3.7）。
//!
//! 为什么单开一份：这一格验的是「真跑一轮之后文件里**真的多出行**、格式逐字对」。
//! 工程师自承那侧没断言过落盘 —— `purge_log::append` 在 `log_dir() == None` 时静默
//! return，而 `LOG_DIR` 是进程级 `OnceLock`，测试里默认没人注入。于是：
//!
//! - 不注入 → `append` 什么都不写，「日志里没有 X」这类断言全是**空断言**；
//! - 注入晚了（跑完清理才注入）→ 第一轮那几行在注入前就丢了，断言变成「有时 1 行、
//!   有时 2 行」。**我在一次全量里就是这么红过一次（651/1）**，红的是用例自己。
//!
//! 所以 `audit_dir()` 必须在**第一次跑清理之前**调，两条用例的第一句都是它。

use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use crate::services::md_cloud::{self, purge};
use crate::tests::md_cloud_purge::{ensure_backup_root, seed_past};
use crate::tests::md_sync::env;
use crate::tests::support::unique_dir;

/// 追责面文件名（设计 §3.7）。
const AUDIT: &str = "md-cloud-purge.log";

/// 注入日志目录（`LOG_DIR` 是 `OnceLock`，一个进程只认第一份），返回 `<root>/logs`。
///
/// 每个进程用独立目录（`unique_dir` 带 pid + 序号 + 纳秒）：断言「这个文件里恰好有
/// 我这两行」时，不能被同一台机器上另一次 `cargo test` 留下的旧行污染。
pub(crate) fn audit_dir() -> std::path::PathBuf {
    static ONCE: OnceLock<std::path::PathBuf> = OnceLock::new();
    ONCE.get_or_init(|| {
        ensure_backup_root();
        let dir = unique_dir("qa-t04-logs");
        crate::platform::log::init(&dir);
        dir.join("logs")
    })
    .clone()
}

pub(crate) fn audit_lines() -> Vec<String> {
    fs::read_to_string(audit_dir().join(AUDIT))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// I9a + I16 + 落盘：今天那份连跑两轮仍在；往期在追责面里各一行、格式逐字。
#[tokio::test]
async fn i9a_today_survives_two_rounds_and_the_audit_log_really_lands() {
    /* **必须先注入日志目录，再跑这一轮**：`purge_log::append` 在 `log_dir() == None` 时
       静默 return，而 `LOG_DIR` 是进程级 `OnceLock`。晚一步注入的话，第一轮那两行会
       一条不落地丢掉，断言就变成「有时 1 行、有时 2 行」—— 实测在一次全量里就是这么
       红过一次（651/1），红的是**这条用例自己**，不是实现。 */
    let _ = audit_dir();
    let fixture = env("qa-t04-i9a").await;
    let root = unique_dir("qa-t04-i9a");
    let dates = ["2018-03-05", "2018-03-06"];
    for date in dates {
        seed_past(&fixture.pool, &root, date).await;
    }
    let today = md_cloud::today();
    fs::write(root.join(format!("{today}.md")), "今天的日记").expect("写当天文件");

    for round in 1..=2 {
        purge::run_folder(&fixture.pool, &root, &[], &today)
            .await
            .expect("清理不该返回错误");
        assert!(
            root.join(format!("{today}.md")).is_file(),
            "第 {round} 轮之后今天那份必须还在（I9a）"
        );
    }
    for date in dates {
        assert!(!root.join(format!("{date}.md")).exists(), "{date} 该被删");
    }

    /* 追责面：真的多出两行，且 `<date>\t<removed>\t<绝对路径>\t<ISO>` 四列都在。 */
    let lines = audit_lines();
    let mine: Vec<&String> = lines
        .iter()
        .filter(|line| line.starts_with("2018-03-"))
        .collect();
    assert_eq!(mine.len(), dates.len(), "两份各一行，实际 {mine:?}");
    for line in mine {
        let cols: Vec<&str> = line.split('\t').collect();
        assert_eq!(
            cols.len(),
            4,
            "LocalFolder 那一路必须带目标（绝对路径）：{line:?}"
        );
        assert_eq!(cols[1], "removed", "第二列是 outcome：{line:?}");
        assert!(
            Path::new(cols[2]).is_absolute() && cols[2].ends_with(&format!("{}.md", cols[0])),
            "第三列必须是「删掉的那个绝对路径」：{line:?}"
        );
        assert!(
            cols[3].len() >= 19 && cols[3].as_bytes()[10] == b'T',
            "第四列是 ISO 本地时间（`2026-11-08T01:29:32`）：{line:?}"
        );
    }
    assert!(
        !lines.iter().any(|line| line.starts_with(&today)),
        "今天那份一次都不许出现在追责面里，实际 {lines:?}"
    );
    let _ = fs::remove_dir_all(&root);
}
