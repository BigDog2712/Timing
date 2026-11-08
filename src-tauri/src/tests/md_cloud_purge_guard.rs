//! 变更 A｜LocalFolder 两处**纯逻辑**判据：闸③ 的路径比较与闸⑥ 的留底。
//!
//! 为什么单独一份：这两组用例都不需要数据库，只需要一个临时目录；而 `folder.rs` 的
//! 行为用例（走真 pool）在 `md_cloud_purge.rs`。两者混在一个文件里会把那边顶到门禁线
//! （单文件 ≤300 行），而它们本来验的也是两件事：**判得对不对** / **跑得对不对**。

use std::fs;
use std::path::{Path, PathBuf};

use crate::models::md_cloud_purge::OVERLAP_TEXT;
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::services::md_cloud::purge::folder::{remove_one, RemoveErr};
use crate::services::md_cloud::purge::overlap::overlaps_binding;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("timing-purge-guard-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建临时目录");
    dir
}

fn binding(root: &Path) -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: root.display().to_string(),
        file: "{date}.md".into(),
        heading: "#### 事项计时".into(),
    }
}

/// I13b 的判据之一：日记根是云端目录的**父目录或子目录**同样危险 —— 会误删主人的日记。
/// `validate_folder` 只挡「完全相同」，所以这一档只能靠这里的运行时检查。
#[test]
fn parent_and_child_directories_are_refused() {
    let root = temp_dir("child");
    let child = root.join("daily");
    fs::create_dir_all(&child).expect("建子目录");

    assert_eq!(
        overlaps_binding(&root, &[binding(&child)]).err(),
        Some(OVERLAP_TEXT.to_string()),
        "子目录算重合"
    );
    assert!(overlaps_binding(&child, &[binding(&root)]).is_err(), "父目录算重合");
    let _ = fs::remove_dir_all(&root);
}

/// 尾分隔符 / 大小写：任一种都是同一个目录（Windows 不区分大小写，比较前统一小写）。
#[test]
fn normalization_catches_case_and_separator_differences() {
    let root = temp_dir("normalize");
    let tail = format!("{}\\", root.display());
    assert!(
        overlaps_binding(&root, &[binding(Path::new(&tail))]).is_err(),
        "尾分隔符不算「不同目录」"
    );

    let upper = root.display().to_string().to_uppercase();
    assert!(
        overlaps_binding(&root, &[binding(Path::new(&upper))]).is_err(),
        "大小写不同还是同一个目录"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 判不出来就拒绝：落点根自己 canonicalize 失败（目录不存在）→ 拒绝清理。
/// 方向必须落在「不删」一侧，因为这是破坏性操作的判据。
#[test]
fn an_unresolvable_root_is_refused() {
    let gone = temp_dir("gone").join("never-created");
    assert_eq!(overlaps_binding(&gone, &[]).err(), Some(OVERLAP_TEXT.to_string()));
}

/// I13e 的机制：留底失败 → **文件仍在**，且原因是 `NoBackup`。
///
/// 变异自检（变更 A 的第 ② 条）：把 `if !save(...)` 改成「调用过就算成功」（忽略返回值），
/// 这条立刻红 —— 文件会被删掉。
#[test]
fn remove_one_without_a_backup_keeps_the_file() {
    let root = temp_dir("no-backup");
    let path = root.join("2026-11-04.md");
    fs::write(&path, "旧内容").expect("写样本");

    let outcome = remove_one(&path, "旧内容".as_bytes(), |_, _| false);
    assert!(matches!(outcome, Err(RemoveErr::NoBackup)), "留不下底就不许删");
    assert!(path.is_file(), "文件必须还在");
    let _ = fs::remove_dir_all(&root);
}

/// 非 UTF-8 文本同样算「没留底」：`from_utf8` 失败宁可漏删，也不用 `lossy` 存一份对不上的底。
#[test]
fn non_utf8_bytes_are_never_deleted() {
    let root = temp_dir("non-utf8");
    let path = root.join("2026-11-04.md");
    let bytes = [0xff, 0xfe, 0x00];
    fs::write(&path, bytes).expect("写样本");

    let outcome = remove_one(&path, &bytes, |_, _| true);
    assert!(matches!(outcome, Err(RemoveErr::NoBackup)));
    assert!(path.is_file());
    let _ = fs::remove_dir_all(&root);
}

/// 留底成功 → 删掉。这条是上面两条的对照，防「怎么都不删」也算绿。
#[test]
fn remove_one_deletes_only_after_a_successful_backup() {
    let root = temp_dir("with-backup");
    let path = root.join("2026-11-04.md");
    fs::write(&path, "旧内容").expect("写样本");

    assert!(remove_one(&path, "旧内容".as_bytes(), |_, _| true).is_ok());
    assert!(!path.exists(), "留底成功了就该删掉");
    let _ = fs::remove_dir_all(&root);
}

/// 闸⑥ 认的是**布尔结果**，不是「调用过」：`save_to` 在备份目录建不出来时必须回 false。
///
/// I13e 的端到端夹具（把 `%APP_DIR%\backups\md` 造成普通文件 / 备份根指到不存在的盘符）
/// 要动真实数据目录，由 QA 手验；这里钉住它背后那个布尔是真的。**不要**用 ACL 只读当
/// 夹具：Windows 上属主常常仍可写，会得到「设了只读却照样删了」这种假阴性。
#[test]
fn backup_reports_failure_when_the_directory_cannot_be_created() {
    let blocker = temp_dir("blocked");
    /* 父级是个名字就叫 `md` 的**普通文件**：`create_dir_all(backups\md)` 必然失败。 */
    fs::write(blocker.join("md"), "x").expect("写占位文件");

    let wrote = crate::infra::md_backup::save_to(
        &blocker.join("md"),
        Path::new("2019-09-05.md"),
        "内容",
    );
    assert!(!wrote, "建不出备份目录时必须回 false（不能静默当成留底成功）");

    let ok_root = blocker.join("ok");
    assert!(
        crate::infra::md_backup::save_to(&ok_root, Path::new("2019-09-05.md"), "内容"),
        "正常目录要回 true，否则闸⑥ 会把所有删除都拦掉"
    );
    let _ = fs::remove_dir_all(&blocker);
}

/* ── 下面两条是同一件事的另一半：判得对（上面）之外，还要**整段不动手** ──
   走真 pool + 真目录：`run_folder` 的入口行为，与 `overlaps_binding` 的纯判定互补。 */

use crate::models::md_cloud_purge::{PurgeChannel, PurgeKey};
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::services::md_cloud::{self, purge};
use crate::services::md_sync::config;
use crate::tests::md_cloud_purge::{binding_of, kv, list_names, seed_past, state_of};
use crate::tests::md_sync::env;
use crate::tests::support::unique_dir;

#[tokio::test]
async fn folder_round_refuses_a_directory_that_overlaps_a_binding() {
    let fixture = env("purge-folder-overlap").await;
    let root = unique_dir("purge-folder-overlap-target");
    for date in ["2019-03-05", "2019-03-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let before: Vec<String> = list_names(&root);

    purge::run_folder(&fixture.pool, &root, &[binding_of(&root)], &md_cloud::today())
        .await
        .expect("闸③ 拒绝不是错误，是一条记账");

    assert_eq!(list_names(&root), before, "重合时一个文件都不许删");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Upto).await,
        None,
        "水位一动不动（用户改好配置后第二天自动恢复）"
    );
    assert_eq!(
        state_of(&fixture.pool, PurgeChannel::Folder).await.overlap_note,
        OVERLAP_TEXT,
        "红字逐字进 state"
    );
    /* 块④ 的红字位是 `status.lastError`：`MdCloudPurgeStatus` 不在线缆里带这句话。 */
    let status = md_cloud::status(&fixture.pool, PurgeChannel::Folder).await.expect("status");
    assert_eq!(status.last_error.as_deref(), Some(OVERLAP_TEXT));
    let _ = fs::remove_dir_all(&root);
}

/// I13d：通道没开（`cloud.enabled=false`）→ 一轮跑完 **0 条清理**，目录零变化。

#[tokio::test]
async fn disabled_cloud_never_purges() {
    let fixture = env("purge-folder-disabled").await;
    let root = unique_dir("purge-folder-disabled-target");
    for date in ["2019-04-05", "2019-04-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let mut stored = config::load(&fixture.pool).await.expect("读配置");
    stored.cloud = Some(MdSyncCloud {
        enabled: false,
        mode: CloudMode::LocalFolder,
        local_root: root.display().to_string(),
        ..Default::default()
    });
    config::save(&fixture.pool, &stored).await.expect("存配置");
    let before: Vec<String> = list_names(&root);

    md_cloud::round(&fixture.pool).await.expect("round 应成功");

    assert_eq!(list_names(&root), before, "通道关着，一个文件都不许动");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day).await,
        None,
        "连 day 都不该写：整轮没跑"
    );
    let _ = fs::remove_dir_all(&root);
}
