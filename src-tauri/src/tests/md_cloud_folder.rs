//! 本地目录通道的「今天已上传」留痕（[V0.11.14] 修 O3）。
//!
//! 断言口径是**行为**：跑完一轮之后设置页那一栏（`md_cloud::status().today_pushed`）
//! 与 `md_cloud_pending` 里的行必须一致；失败的一轮**一行都不许记**。
//!
//! 为什么要单开一份而不是塞进 `md_cloud_round`：那边贴着 300 行门禁，而这里的用例
//! 需要真文件系统（可写目录 / 建不出来的目录 / 落点位置被一个目录占住）。
//!
//! 三种失败口径要分清，**别用 A 的绿去证 B**（[V0.11.14] QA 变异自检抓到的坑）：
//! - 建不出根目录 → `run` 早返回，根本走不到「记成功态」那段；
//! - 根目录建出来了、但某个落点写不出去 → 才轮到 `wrote_ok` 这个判据；
//! - 一个落点写成功、另一个失败 → 此时 `today_hash` 取得到指纹，`wrote_ok` 是**唯一**
//!   拦住假「今天已上传」的东西（`folder_round_partial_failure_records_nothing` 钉这条）。

use std::fs;
use std::path::Path;

use crate::models::md_sync::MdSyncKind;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending;
use crate::services::md_cloud::{self, pending};
use crate::services::md_sync::config;
use crate::services::md_sync::mirror;
use crate::tests::md_sync::{binding, env, save_binding, NOTES_HEADING};
use crate::tests::support::{insert_saved, new_item, scalar_i64, unique_dir};

/// 把云端通道设成 `LocalFolder`（`local_root` 由调用方给，可以是「看起来合法但写不进去」）。
async fn set_folder_cloud(pool: &sqlx::SqlitePool, local_root: &Path) {
    let mut stored = config::load(pool).await.expect("读配置应成功");
    stored.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: local_root.display().to_string(),
        ..Default::default()
    });
    config::save(pool, &stored)
        .await
        .expect("保存云端配置应成功");
}

/// 写成功 → 记一次成功态，设置页那栏变「今天已上传」。
///
/// 回滚修复这条用例就红：一行都不写时 `today_pushed` 恒为 `false`（这正是 O3 的现象）。
#[tokio::test]
async fn folder_round_success_records_today_as_pushed() {
    let fixture = env("cloud-folder-pushed").await;
    let cloud_dir = unique_dir("cloud-folder-pushed-target");
    set_folder_cloud(&fixture.pool, &cloud_dir).await;

    /* 必须有内容可写，否则这一轮什么都不落盘，也就没有「已上传」这回事。 */
    let item = new_item(&fixture.pool, "读书").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 300_000, now, 300).await;

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(outcome.report.errors.is_empty(), "{:?}", outcome.report.errors);

    let status = md_cloud::status(&fixture.pool).await.expect("status 应成功");
    assert!(
        status.today_pushed,
        "本地目录模式写完一轮之后，「今天已上传」不能还是假的"
    );

    /* 指纹必须是**云端那份文件**的：它是「哪一份内容算传上去了」的唯一依据。 */
    let rels = mirror::mirror_paths(&fixture.pool)
        .await
        .expect("算镜像路径应成功");
    let target = cloud_dir.join(rels.first().expect("至少要有一个落点文件"));
    let bytes = fs::read(&target).expect("云端目录里应出现今日文件");
    let row = md_cloud_pending::get(&fixture.pool, &outcome.today)
        .await
        .expect("查询应成功")
        .expect("写成功就该留下这一行");
    assert_eq!(row.pending_since, 0, "写进目录就是同步完了，不该有欠账");
    assert_eq!(
        row.last_hash,
        Some(pending::fingerprint(&bytes)),
        "指纹要取云端那份文件，不是别的副本"
    );
    assert_eq!(row.etag, None, "本地目录没有 ETag 这个概念");
}

/// 云端目录建不出来 → 一行都不记，「今天已上传」保持为假。
///
/// **这条钉的是「早返回」那一支**：`run` 在 `create_dir_all` 失败时就 `return` 了，
/// 走不到「记成功态」那段代码，所以它**不能**用来证明 `wrote_ok` 判据有效
/// （[V0.11.14] 变异自检实测：把 `wrote_ok` 改成恒 `true`，这条用例仍然绿）。
/// 需要那个判据的那一支见 `folder_round_partial_failure_records_nothing`。
#[tokio::test]
async fn folder_round_failure_records_nothing() {
    let fixture = env("cloud-folder-failed").await;
    let blocker = unique_dir("cloud-folder-blocker");
    fs::create_dir_all(&blocker).expect("建临时目录应成功");
    /* 父级是个**文件**：`create_dir_all` 必然失败（比「权限不够」更可移植）。 */
    let blocker_file = blocker.join("not-a-dir");
    fs::write(&blocker_file, b"x").expect("写占位文件应成功");
    set_folder_cloud(&fixture.pool, &blocker_file.join("sub")).await;

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(
        !outcome.report.errors.is_empty(),
        "建不了目录必须进报告，否则用户以为这一轮成功"
    );
    let status = md_cloud::status(&fixture.pool).await.expect("status 应成功");
    assert!(!status.today_pushed, "没写出去的一轮不许说「今天已上传」");
    assert!(
        md_cloud_pending::get(&fixture.pool, &outcome.today)
            .await
            .expect("查询应成功")
            .is_none(),
        "失败的一轮连行都不该有"
    );
}

/// [V0.11.17] B4：本地目录通道仍要**比对文件与 SQL**。
///
/// 主人的原话：「在云端使用本地同步时，云端不再同步，但依然要比对此文件与 sql 中是否
/// 有变动」。`round_folder::run` 不往 WebDAV 发任何请求（现状，不动），但它经
/// `mirror::run_in(pool, root)` 把 root 里那份 `{date}.md` 的手改导回 SQL：
/// `sync_all(Some(root))` → `sync_binding` → 文件侧变更时 `import_and_render`。
///
/// 这条用例就是那件事的机器判据：**先**在 root 里放一段 SQL 里没有的手写便利贴，
/// 跑一轮 `round_folder::run`，**再**断言 SQL 查得到、且 `md_cloud_pending` 记了指纹
/// （设置页那栏不再是「今天还没上传」）。
#[tokio::test]
async fn folder_round_imports_handwritten_md_back_into_sql() {
    let fixture = env("cloud-folder-import").await;
    let cloud_dir = unique_dir("cloud-folder-import-target");
    set_folder_cloud(&fixture.pool, &cloud_dir).await;

    /* 前提：SQL 里一条便利贴都没有（下面的手写段落是**净新增**）。 */
    let before = scalar_i64(
        &fixture.pool,
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL",
    )
    .await;
    assert_eq!(before, 0, "用例前提：SQL 里本来没有便利贴");

    /* 在云端目录里手写一段便利贴：只有文件侧有，SQL 侧没有。 */
    fs::create_dir_all(&cloud_dir).expect("建临时云端目录应成功");
    let today = crate::services::md_cloud::today();
    let rel = format!("{today}.md");
    let handwritten = "云端手写的这一段";
    let body = format!(
        "{NOTES_HEADING}\n| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| {today} 09:00:00 | 生活 | {handwritten} |\n"
    );
    fs::write(cloud_dir.join(&rel), body).expect("写手写日记应成功");

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(outcome.report.errors.is_empty(), "{:?}", outcome.report.errors);

    /* ① SQL 里查得到这段手写内容（= 文件侧变动被导回） */
    let contents: Vec<String> = sqlx::query_scalar(
        "SELECT content FROM notes WHERE deleted_at IS NULL",
    )
    .fetch_all(&fixture.pool)
    .await
    .expect("查询便利贴应成功");
    assert!(
        contents.iter().any(|text| text == handwritten),
        "手写的便利贴必须被导回 SQL，实际是 {contents:?}"
    );

    /* ② 设置页那栏不是「今天还没上传」：`md_cloud_pending` 记了指纹 */
    let status = md_cloud::status(&fixture.pool).await.expect("status 应成功");
    assert!(
        status.today_pushed,
        "比对完并写回之后，「今天已上传」不能还是假的"
    );
    let row = md_cloud_pending::get(&fixture.pool, &outcome.today)
        .await
        .expect("查询应成功")
        .expect("成功的一轮必须留下指纹行");
    assert_eq!(row.pending_since, 0, "写进目录就是同步完了，不该有欠账");
    /* 指纹必须是**云端那份文件**的（写回后重新渲染过的内容） */
    let bytes = fs::read(cloud_dir.join(&rel)).expect("云端目录里应有今日文件");
    assert_eq!(
        row.last_hash,
        Some(pending::fingerprint(&bytes)),
        "指纹要取云端那份文件"
    );
}

///
/// 这是 `wrote_ok` 判据唯一能生效的形状：第一个落点写成功，于是 `today_hash` **取得到**
/// 指纹，`mark_synced` 完全够得着；只有「本轮 `errors` 非空」这一个条件能拦住它。
///
/// 变异自检：把 `round_folder::run` 里的 `let wrote_ok = cloud_report.errors.is_empty()`
/// 改成恒 `true`，这条用例立刻红（`today_pushed` 变成 `true`、行也被写上）；
/// 而 `folder_round_failure_records_nothing` 在同一变异下**仍然绿**。
///
/// 失败怎么造：把「便利贴」这个落点的目标路径先建成一个**目录**。`read_section` 见到
/// 非文件会回「落点不是文件」，比伪造权限更可移植（Windows 上目录的只读位不挡创建文件）。
#[tokio::test]
async fn folder_round_partial_failure_records_nothing() {
    let fixture = env("cloud-folder-partial").await;
    let cloud_dir = unique_dir("cloud-folder-partial-target");
    set_folder_cloud(&fixture.pool, &cloud_dir).await;
    /* 便利贴落到 `blocked.md`；下面把这个位置占成一个目录 → 那一路必然报错。 */
    save_binding(
        &fixture.pool,
        binding(MdSyncKind::Notes, &fixture.vault, "blocked.md", NOTES_HEADING),
    )
    .await;
    fs::create_dir_all(cloud_dir.join("blocked.md")).expect("建占位目录应成功");

    /* 计时这一路要有内容才写得出去：`today_hash` 取「第一份存在的文件」，得先有。 */
    let item = new_item(&fixture.pool, "读书").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 300_000, now, 300).await;

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(
        !outcome.report.errors.is_empty(),
        "有一个落点写不出去，报告里必须有错误：{:?}",
        outcome.report
    );
    /* 前置条件自证：第一份文件确实落下去了，否则下面「没有指纹所以没记」是白绿。 */
    assert!(
        cloud_dir.join(format!("{}.md", outcome.today)).is_file(),
        "第一个落点应已写出来——否则这条用例证不到 `wrote_ok`"
    );

    let status = md_cloud::status(&fixture.pool).await.expect("status 应成功");
    assert!(
        !status.today_pushed,
        "有落点没写出去的一轮不许说「今天已上传」"
    );
    assert!(
        md_cloud_pending::get(&fixture.pool, &outcome.today)
            .await
            .expect("查询应成功")
            .is_none(),
        "部分失败的一轮连行都不该有"
    );
}
