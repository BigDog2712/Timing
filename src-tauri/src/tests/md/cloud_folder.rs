//! 本地目录通道：**事件流落档**的端到端判据（0.14.x 起）。
//!
//! 这一份盯三件事，每件都必须是「行为」而不是「调了一下函数」：
//!
//! 1. **落点里出现的是分段，不是 md**：一轮跑完 `sync/events/<设备id>/1.jsonl` 存在、
//!    能解码出本轮的事件，而且同一个目录里**没有** `{date}.md`（旧格式必须消失，
//!    否则「换成事件流」只是多写了一份）；
//! 2. **「今天已上传」由游标回答**：跑完一轮，设置页那栏（`status.today_pushed`）必须是
//!    真的。判据取法换了：以前看 `md_cloud_pending` 的行，现在看 `sync_event_cursor` ——
//!    那张表是上传进度的唯一事实；
//! 3. **根目录建不出来时什么都不记**：一轮一个字节都没写出去，状态必须仍是「还没上传」。
//!
//! 为什么要单开一份而不是塞进 `cloud_round`：那边贴着 300 行门禁，而这里的用例需要
//! 真文件系统（可写目录 / 建不出来的目录）与真事件。
//!
//! **手写 md 的导入仍然存在**，但它现在只发生在**用户自己的笔记目录**（bindings 的
//! `root`）—— 落点不再是给人改的地方，那里只有不可变分段。

use std::fs;
use std::path::Path;

use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::platform::clock::now_ms;
use crate::repositories::timer_ops as op_repo;
use crate::services::md_cloud;
use crate::services::md_sync::config;
use crate::services::md_sync::decision::ConflictMode;
use crate::services::sync_stream::segment::decode_segment;
use crate::services::timer_ops::TimerOpKind;
use crate::tests::support::{new_item, unique_dir};

use super::sync::{env, NOTES_HEADING};

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

/// 本机身份。事件没有 uid 就传不出去（`push` 的两条过滤条件），判据必须先拿到它。
fn device() -> &'static str {
    crate::services::identity::install_id().expect("测试环境应能生成 install_id")
}

/// 造一段「开始 → 结束」的真实事件，返回会话 uid。
async fn make_events(pool: &sqlx::SqlitePool, item: i64) -> String {
    let dev = device();
    let today = md_cloud::today();
    let now = now_ms();
    let start = op_repo::start_session(pool, item, now - 300_000, &today, "countup", None, dev)
        .await
        .expect("造开始事件应成功");
    op_repo::append(pool, &start.session_uid, TimerOpKind::Stop, now, &today, None, dev)
        .await
        .expect("造结束事件应成功");
    start.session_uid
}

/// 一轮之后：落点里是分段、不是 md；状态是「今天已上传」。
#[tokio::test]
async fn folder_round_writes_segments_and_marks_today_pushed() {
    let fixture = env("cloud-folder-segment").await;
    let cloud_dir = unique_dir("cloud-folder-segment-target");
    set_folder_cloud(&fixture.pool, &cloud_dir).await;

    let item = new_item(&fixture.pool, "读书").await;
    let session = make_events(&fixture.pool, item).await;

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 应成功");
    assert!(outcome.report.errors.is_empty(), "{:?}", outcome.report.errors);

    /* ① 分段：第一段、能解码、装的就是这两个事件。
       文件名是 8 位零填充（`%08d`）—— 这里**写死**字面量，不用 `segment_path()`：
       用生产函数算路径等于拿被测代码证被测代码，落盘契约必须由判据自己钉住。 */
    let segment = cloud_dir
        .join("sync")
        .join("events")
        .join(device())
        .join("00000001.jsonl");
    let bytes = fs::read(&segment).expect("落点里应出现第一段事件分段");
    let ops = decode_segment(&bytes).expect("分段必须能解码（含完整性尾标）");
    assert_eq!(ops.len(), 2, "一段里应有开始与结束两条事件");
    assert!(
        ops.iter().all(|op| op.session_uid == session),
        "分段里的事件必须都属于这次会话"
    );

    /* ② 旧格式必须消失：这条是「换成事件流」的正面判据，不是附属断言。 */
    assert!(
        !cloud_dir.join(format!("{}.md", outcome.today)).exists(),
        "落点里不许再出现 md 快照 —— 落档格式已经换成事件分段"
    );

    /* ③ 状态：游标推进到本机最后一条事件，于是「今天已上传」为真。 */
    let status = md_cloud::status(&fixture.pool, PurgeChannel::Folder)
        .await
        .expect("status 应成功");
    assert!(
        status.today_pushed,
        "分段已经写进落点，「今天已上传」不能还是假的"
    );
    assert!(status.pending_dates.is_empty(), "传完就没有待传的日期");
}

/// 根目录建不出来 → 什么都没写出去，状态保持「今天还没上传」。
#[tokio::test]
async fn folder_round_failure_records_error_and_keeps_status_false() {
    let fixture = env("cloud-folder-failed").await;
    let blocker = unique_dir("cloud-folder-blocker");
    fs::create_dir_all(&blocker).expect("建临时目录应成功");
    /* 父级是个**文件**：`create_dir_all` 必然失败（比「权限不够」更可移植）。 */
    let blocker_file = blocker.join("not-a-dir");
    fs::write(&blocker_file, b"x").expect("写占位文件应成功");
    set_folder_cloud(&fixture.pool, &blocker_file.join("sub")).await;

    let item = new_item(&fixture.pool, "读书").await;
    make_events(&fixture.pool, item).await;

    let outcome = md_cloud::round(&fixture.pool).await.expect("round 不该折成 Err");
    assert!(
        !outcome.report.errors.is_empty(),
        "落点建不出来必须有错误：{:?}",
        outcome.report
    );

    let status = md_cloud::status(&fixture.pool, PurgeChannel::Folder)
        .await
        .expect("status 应成功");
    assert!(
        !status.today_pushed,
        "一个字节都没写出去的一轮不许说「今天已上传」"
    );
    assert_eq!(
        status.pending_dates,
        vec![outcome.today.clone()],
        "事件还在本机：这一天必须留在待传清单里"
    );
}

/// 用户在自己笔记目录里手写的内容仍要能导回 SQL（md 渲染是**本地功能**，与落档格式无关）。
///
/// 两步跑：先让一轮把当天的区块渲染出来（此时文件里还没有便利贴段），再**追加**一段手写
/// 的便利贴表，第二轮导回。一次就写一个只有便利贴的文件不行 —— 那样时间区块是「文件里
/// 有、SQL 里也有」的假冲突，用例会红在冲突上而不是导入上。
#[tokio::test]
async fn folder_round_imports_handwritten_md_from_the_vault() {
    let fixture = env("cloud-folder-import").await;
    let cloud_dir = unique_dir("cloud-folder-import-target");
    set_folder_cloud(&fixture.pool, &cloud_dir).await;

    let item = new_item(&fixture.pool, "读书").await;
    make_events(&fixture.pool, item).await;
    md_cloud::round(&fixture.pool).await.expect("首轮应成功");

    /* 前提：SQL 里一条便利贴都没有（下面追加的段落是**净新增**）。 */
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
        .fetch_one(&fixture.pool)
        .await
        .expect("数便利贴应成功");
    assert_eq!(before, 0, "用例前提：SQL 里本来没有便利贴");

    /* 追加到**笔记目录**里当天的文件（binding root），不再写进落点。 */
    let today = md_cloud::today();
    let file = fixture.vault.join(format!("{today}.md"));
    let handwritten = "笔记里手写的这一段";
    let row = format!("| {today} 09:00:00 | 生活 | {handwritten} |\n");
    let mut body = fs::read_to_string(&file).expect("首轮之后当日文件应已存在");
    body.push_str(&format!("\n{NOTES_HEADING}\n| 更新时间 | 事项 | 内容 |\n|---|---|---|\n{row}"));
    fs::write(&file, body).expect("写手写日记应成功");

    /* AutoMerge：手写段落在「文件有、SQL 无」这一侧，`Awaiting` 会把它挂成待决策
       （`dir=pending`）而不是直接入库。这条用例要证的是「导入这条链没断」，用能落库的模式。 */
    let outcome = md_cloud::round_with(&fixture.pool, ConflictMode::AutoMerge)
        .await
        .expect("第二轮应成功");
    assert!(outcome.report.errors.is_empty(), "{:?}", outcome.report.errors);

    let contents: Vec<String> =
        sqlx::query_scalar("SELECT content FROM notes WHERE deleted_at IS NULL")
            .fetch_all(&fixture.pool)
            .await
            .expect("查询便利贴应成功");
    assert!(
        contents.iter().any(|text| text == handwritten),
        "手写的便利贴必须被导回 SQL，实际是 {contents:?}"
    );
}
