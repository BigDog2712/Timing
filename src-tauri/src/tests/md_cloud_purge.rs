//! 变更 A｜云端往期真删的**行为**判据（V0.11.19，PRD I2–I18 里能离线机验的那部分）。
//!
//! 两路分开验，**不拿一路的绿去证另一路**：
//! - LocalFolder（六道闸）：走真文件系统，含留底份数、指纹闸、目录重合、批上限、暂停；
//! - WebDAV（镜像取证）：只验「删的是远端、镜像一个文件都不动」与「失败不动水位」，
//!   真实的 DELETE 需要假服务器，那一档在 QA 手验（I2）里做。
//!
//! ## 几个绕不开的全局状态
//!
//! `md_backup::set_root` 是 `OnceLock`（一个进程只认第一份），所以这里**只设一次**，
//! 断言走 `md_backup::list()`（读的是当前生效的那份根），而不是某个自造目录。
//! 备份名按 `<tag>__<源文件名>-<时间戳>.md` 生成，各用例用**互不相同的年份/月份**
//! 造日期，这样「多 3 份前缀 folder」在并行执行时也不会串到别人的用例上。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::infra::md_backup;
use crate::models::md_cloud_purge::{channel_key, PurgeChannel, PurgeKey, PurgeState};
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::repositories::{md_cloud_pending, settings};
use crate::services::md_cloud::{self, pending, purge};
use crate::tests::md_sync::env;
use crate::tests::support::unique_dir;

/// 备份根只注入一次（`OnceLock`）。
pub(crate) fn ensure_backup_root() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("timing-purge-backups-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        md_backup::set_root(dir);
    });
}

/// 造一份「Timing 写过、之后没人动过」的往期：文件 + pending 行（指纹与文件一致）。
pub(crate) async fn seed_past(pool: &sqlx::SqlitePool, root: &Path, date: &str) -> PathBuf {
    ensure_backup_root();
    fs::create_dir_all(root).expect("建云端目录");
    let path = root.join(format!("{date}.md"));
    let body = format!("#### 事项计时\n\n| {date} 09:00:00 | 读书 | 25 分 |\n");
    fs::write(&path, &body).expect("写往期文件");
    md_cloud_pending::mark_synced(pool, date, None, &pending::fingerprint(body.as_bytes()))
        .await
        .expect("记 pending 行");
    path
}

pub(crate) fn binding_of(root: &Path) -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: root.display().to_string(),
        file: "{date}.md".into(),
        heading: "#### 事项计时".into(),
    }
}

pub(crate) async fn kv(pool: &sqlx::SqlitePool, channel: PurgeChannel, kind: PurgeKey) -> Option<String> {
    settings::get_value(pool, channel_key(channel, kind))
        .await
        .expect("读 KV")
}

pub(crate) async fn state_of(pool: &sqlx::SqlitePool, channel: PurgeChannel) -> PurgeState {
    kv(pool, channel, PurgeKey::State)
        .await
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// I13a + I18：由 Timing 写过、没人动过的往期**被删**，当天那份保留，留底 +3 份，
/// `md_cloud_pending` 的行跟着清掉，水位推到最晚那一个。
#[tokio::test]
async fn folder_round_deletes_past_files_and_keeps_today() {
    let fixture = env("purge-folder-basic").await;
    let root = unique_dir("purge-folder-basic-target");
    let dates = ["2019-01-05", "2019-01-06", "2019-01-07"];
    for date in dates {
        seed_past(&fixture.pool, &root, date).await;
    }
    /* 当天那份：`read_dir` 会枚举到它，但它**永远不进候选**（I9a）。 */
    let today = md_cloud::today();
    fs::write(root.join(format!("{today}.md")), "今天的日记").expect("写当天文件");

    /* 生产路径里 `round_folder` 在清理之前先 `register_root(root, "folder")`；
       这里直呼 `purge::run_folder`，所以要照抄这一步，否则留底会被标成 obsidian。 */
    md_backup::register_root(root.clone(), "folder");
    let before = backup_count(&dates);
    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("清理不该返回错误");

    for date in dates {
        assert!(
            !root.join(format!("{date}.md")).exists(),
            "{date} 是 Timing 写过且没被改过的往期，应当被删"
        );
        assert!(
            md_cloud_pending::get(&fixture.pool, date)
                .await
                .expect("查 pending")
                .is_none(),
            "删成功之后那天的账要清掉（I18）"
        );
    }
    assert!(
        root.join(format!("{today}.md")).is_file(),
        "今天那份是唯一还在被读写的一份，绝不删"
    );
    assert_eq!(
        backup_count(&dates),
        before + dates.len(),
        "闸⑥：每删一份都要在 backups\\md 里多一份 folder 前缀的底（I13a）"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Upto)
            .await
            .as_deref(),
        Some("2019-01-07"),
        "水位推进到本批最大成功日期"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day)
            .await
            .as_deref(),
        Some(today.as_str()),
        "扫完一整遍才写 day（今天不再扫）"
    );
    assert_eq!(
        state_of(&fixture.pool, PurgeChannel::Folder).await.last_deleted,
        3
    );
    let _ = fs::remove_dir_all(&root);
}

/// I13c：被改过一个字节的那份**不删**，其余照删，**那一行也不清**（证据要留到下一轮）。
#[tokio::test]
async fn folder_round_skips_a_file_whose_bytes_changed() {
    let fixture = env("purge-folder-changed").await;
    let root = unique_dir("purge-folder-changed-target");
    let dates = ["2019-02-05", "2019-02-06", "2019-02-07"];
    for date in dates {
        seed_past(&fixture.pool, &root, date).await;
    }
    /* 把中间那份改一个字节：它还是那个名字，但已经不是我们写的那份了。 */
    let touched = root.join("2019-02-06.md");
    let mut bytes = fs::read(&touched).expect("读回");
    bytes.push(b'!');
    fs::write(&touched, &bytes).expect("改字节");

    purge::run_folder(&fixture.pool, &root, &[], &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    assert!(touched.is_file(), "指纹不符的那一份不许删（闸⑤-b）");
    assert!(!root.join("2019-02-05.md").exists(), "其余照删");
    assert!(!root.join("2019-02-07.md").exists(), "其余照删");
    assert!(
        md_cloud_pending::get(&fixture.pool, "2019-02-06")
            .await
            .expect("查 pending")
            .is_some(),
        "没删的那一天，pending 行必须保留 —— 它是下一轮唯一的证据"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 目录里的文件名快照（升序）。断言「一个文件都不许删」用它，比逐个 `exists()` 更严。
pub(crate) fn list_names(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    names.sort_unstable();
    names
}

/// 与 `dates` 有关、且前缀是 `folder` 的备份份数（并行执行时不会串到别人的用例上）。
fn backup_count(dates: &[&str]) -> usize {
    md_backup::list()
        .into_iter()
        .filter(|file| file.target == Some("folder"))
        .filter(|file| dates.iter().any(|date| file.source == format!("{date}.md")))
        .count()
}
