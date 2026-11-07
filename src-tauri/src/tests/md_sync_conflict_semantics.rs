//! Markdown 合并语义的**现状快照**（V0.11.18，PRD C9 / 设计 §6）。
//!
//! ## 这个文件钉的是「现在真的是什么样」，不是「应该是什么样」
//!
//! 下面五条都是 v0.11.17 已交付行为的**照片**。它们看着不理想，但都是当前设计的必然
//! 结果，**不是本轮要修的 bug**（PRD §13.1 裁决 2 / N13：只补回归测试，行为一个字不动）。
//!
//! | 场景 | 现状 | 根因 |
//! |---|---|---|
//! | 计时：同一事项两端各加一段 | 只留一段 —— md 那段**吸收了 PC 那段**（同一行 id，时间被改写） | `import/timers.rs` 的 `claim_rows` 两轮配对（精确 → 顺序兜底） |
//! | 待办：文件里删掉一条 | 删除**不生效**，下一轮导出又出现 | `import/todos.rs:5-16` 模块注释「这里不删任何东西」 |
//! | 便利贴：删掉再加回同文本 | 复活成**新 id**，旧行留软删 | `import.rs` `find_by_id` 过滤软删 → `None` → `insert` |
//! | 进程重启后的第一轮 | 任何删除都不生效（基线不落库，旧区块按空串处理） | `runtime.rs:8-9`「基线不落库」 |
//! | 整段重写 | 非 Timing 行被保留 | `infra/md_file.rs` `write_section` 只替换标题下那一段 |
//!
//! **失败信息统一写**：`这是已知限制，改行为前先改这里`。
//! 谁想改这五条里的任何一条，正确动作是：**先改这个文件**（把断言改成新的期望），再改
//! 产品代码 —— 这样 review 时「行为变了」这件事一定会被看见。
//!
//! ## 夹具复用，不复制
//!
//! `tests/md_sync.rs` 的 `Env` / `env(tag)` / `binding` / `save_binding` / `file_for` 是
//! `pub(super)` 的，本文件与它同属 `tests` 模块 → 直接 `use super::md_sync::{…}`。
//! **不要复制一份**：两套夹具意味着两套「安全底线」（`md_sync.rs` 里那段「每个用例开跑前
//! 先把三种 kind 一次锁到临时目录」的注释），漏一套就会写到用户的真实文档目录去。
//!
//! 所以本文件**一个 `save_binding` 都不调**：`env(tag)` 已经把三档落点全部指向它自己的
//! 临时目录（`{date}.md` + 三个固定标题），五个用例直接用那份配置。

use chrono::NaiveDate;
use sqlx::SqlitePool;

use super::md_sync::{at, env, file_for, Env, NOTES_HEADING, TIMERS_HEADING, TODOS_HEADING};
use crate::infra::md_file;
use crate::repositories::todo as todo_repo;
use crate::services;
use crate::tests::support::{insert_saved, new_item, scalar_i64};

/// 「已知限制」的统一失败信息（PRD C9 的测试命名纪律）。
const KNOWN: &str = "这是已知限制，改行为前先改这里";

/// `YYYY-MM-DD HH:MM:SS`（与 `format::format_ts` 同格式，用于手写文件里的时间）
fn ts(date: NaiveDate, hour: u32, minute: u32) -> String {
    format!("{} {:02}:{:02}:00", date.format("%Y-%m-%d"), hour, minute)
}

fn body_of(env: &Env, heading: &str) -> String {
    let text = std::fs::read_to_string(file_for(env)).unwrap_or_default();
    md_file::body_in_text(&text, heading).unwrap_or_default()
}

/// 把某个标题下的正文换成 `body`（模拟用户在编辑器里手改那一段）。
///
/// 文件还不存在时也成立（`replace_in_text` 在找不到标题时走 `append_section`）——
/// 「场景 4」正是「软件关着的时候编辑器里已经有一份文件」那一态。
fn rewrite(env: &Env, heading: &str, body: &str) {
    let path = file_for(env);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&path, md_file::replace_in_text(&text, heading, body)).unwrap();
}

/// 存活 saved 记录：`(id, started_at)`，按开始时刻升序。
async fn live_records(pool: &SqlitePool) -> Vec<(i64, i64)> {
    sqlx::query_as::<_, (i64, i64)>(
        "SELECT id, started_at FROM time_records \
         WHERE status = 'saved' AND deleted_at IS NULL ORDER BY started_at",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// 场景 1：同一事项、**两端各加一段**。
///
/// 时间线：库里先有一段 09:00–09:30；PC 端又加了一段 11:00–11:30（只进库）；
/// 同一时刻 MD 端在文件里加了一段 14:00–14:30（只进文件）。
///
/// **现状**：`claim_rows` 第 1 轮精确匹配把 09:00 认回自己那行；14:00 那一段在第 2 轮
/// 「顺序兜底」里认领了 11:00 那行 —— 于是 **PC 加的那段被 md 加的段改写掉**，两段并成
/// 一段，总条数不增加。这正是主人反馈的「两端各加一段会互相覆盖」。
#[tokio::test]
async fn timers_two_sided_insert_keeps_only_one_segment() {
    let env = env("conflict-timers").await;
    let item = new_item(&env.pool, "写代码").await;
    let nine = insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    /* 第一轮：建立基线（文件 = 一段） */
    services::md_sync::run(&env.pool).await.unwrap();
    assert!(body_of(&env, TIMERS_HEADING).contains("09:00:00"));

    /* PC 端加一段：只进库，文件不动 */
    let eleven = insert_saved(&env.pool, item, at(env.date, 11, 0), at(env.date, 11, 30), 1800).await;

    /* MD 端加一段：只进文件（同一事项的 `log:` 列表里再追加一段）。
       整段重写而不是对现有文本做字符串替换：「  ```」这个片段在 `  ```yaml` 里也出现一次，
       替换会把围栏标记一起吃掉，用例就变成在测别的形状了。 */
    rewrite(
        &env,
        TIMERS_HEADING,
        &format!(
            "- [ ] 写代码\n  ```yaml\n  planner:\n    log:\n      - start: {}\n        end: {}\n      - start: {}\n        end: {}\n  ```",
            ts(env.date, 9, 0),
            ts(env.date, 9, 30),
            ts(env.date, 14, 0),
            ts(env.date, 14, 30)
        ),
    );

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let live = live_records(&env.pool).await;
    // 实测 v0.11.17: 2 段（不是 3 段——PC 加的那段没有被保留成第三条记录）
    assert_eq!(live.len(), 2, "{KNOWN}：两端各加一段不会得到三段");
    // 实测 v0.11.17: 存活的是 09:00 与 14:00
    assert_eq!(
        live.iter().map(|(_, start)| *start).collect::<Vec<_>>(),
        vec![at(env.date, 9, 0), at(env.date, 14, 0)],
        "{KNOWN}：11:00 那段被 md 的 14:00 改写掉了"
    );
    // 实测 v0.11.17: 14:00 那段的 id == PC 那段（11:00）的 id —— 「吸收」而不是「新建」
    assert_eq!(live[1].0, eleven, "{KNOWN}：md 那段落在 PC 那行上（同一行 id）");
    assert_ne!(live[0].0, live[1].0);
    assert_ne!(live[1].0, nine);
    // 文件侧已被重渲染成规范化结果：只剩库里那两段
    let rendered = body_of(&env, TIMERS_HEADING);
    assert!(rendered.contains("14:00:00"), "重渲染应写出 14:00");
    assert!(!rendered.contains("11:00:00"), "{KNOWN}：11:00 从文件里也消失了");
}

/// 场景 2：待办从文件里删掉 → **SQL 里仍在**，下一轮导出又出现。
///
/// 这一条由 `import/todos.rs:5-16` 的设计决定，不是漏写：待办区块是**过滤后的视图**
/// （排除今天要执行的、排除已完成的），「文件里没有」说明不了用户想删它。
/// 按「缺失即删除」处理，会在跨天那一秒把整批待办删光。
#[tokio::test]
async fn todo_removed_from_file_survives_in_sql() {
    let env = env("conflict-todos").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let now = at(env.date, 8, 0);
    let todo = todo_repo::insert(&env.pool, "写季度总结", None, Some(at(tomorrow, 9, 0)), None, 0, now)
        .await
        .unwrap();

    services::md_sync::run(&env.pool).await.unwrap();
    assert!(body_of(&env, TODOS_HEADING).contains("写季度总结"));

    /* 用户在编辑器里把那一行删掉（连表头都不留，整段清空） */
    rewrite(&env, TODOS_HEADING, "");
    services::md_sync::run(&env.pool).await.unwrap();

    // 实测 v0.11.17: deleted_at IS NULL（1 = 还活着），删除一字未生效
    let alive = scalar_i64(
        &env.pool,
        &format!("SELECT COUNT(*) FROM todos WHERE id = {todo} AND deleted_at IS NULL"),
    )
    .await;
    assert_eq!(alive, 1, "{KNOWN}：待办区块一行都不删");
    // 实测 v0.11.17: 下一轮导出把它又写回文件（用户会看到「删了又回来」）
    assert!(
        body_of(&env, TODOS_HEADING).contains("写季度总结"),
        "{KNOWN}：下一轮导出又出现"
    );
}

/// 场景 3：便利贴被删掉、再加回**同文本** → 复活成**新 id**（旧行留软删）。
///
/// 根因：导入用 `find_by_id` 找已有行，而它**过滤软删** → 拿不到 → 走 `insert`。
/// 于是「删了再加回」永远不是「复活」，而是「新建一条」。
#[tokio::test]
async fn note_deleted_then_readded_comes_back_with_new_id() {
    let env = env("conflict-notes").await;
    let note = crate::repositories::note::insert(
        &env.pool,
        None,
        "买牛奶",
        crate::models::note::NoteGeometry { pos_x: 160.0, pos_y: 160.0, width: 280.0, height: 200.0 },
        at(env.date, 9, 0),
    )
    .await
    .unwrap();

    services::md_sync::run(&env.pool).await.unwrap();
    assert!(body_of(&env, NOTES_HEADING).contains(&format!("<!-- tb-note:{note} -->")));

    /* 删掉整块（连表头一起删：空表头留着会被解析成 3 行空单元格，反而是噪声） */
    rewrite(&env, NOTES_HEADING, "");
    services::md_sync::run(&env.pool).await.unwrap();
    // 实测 v0.11.17: 旧行 deleted_at 非空（软删生效）
    let old_deleted = scalar_i64(
        &env.pool,
        &format!("SELECT COUNT(*) FROM notes WHERE id = {note} AND deleted_at IS NOT NULL"),
    )
    .await;
    assert_eq!(old_deleted, 1, "删块本身是生效的（这条不是缺陷）");

    /* 把同文本那一行**不带 id 注释**写回文件 = 用户在编辑器里重新敲了一遍 */
    rewrite(
        &env,
        NOTES_HEADING,
        &format!("| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| {} | — | 买牛奶 |", ts(env.date, 9, 0)),
    );
    services::md_sync::run(&env.pool).await.unwrap();

    let fresh = scalar_i64(&env.pool, "SELECT MAX(id) FROM notes WHERE deleted_at IS NULL").await;
    // 实测 v0.11.17: 新 id = 旧 id + 1（复活成新行，不是把旧行救回来）
    assert!(fresh > note, "{KNOWN}：同文本回填会得到新 id（实测 max 存活 id = {fresh}，原 {note}）");
    assert_eq!(fresh, note + 1, "{KNOWN}：实测就是「紧接一条新行」");
    let old_still_deleted = scalar_i64(
        &env.pool,
        &format!("SELECT COUNT(*) FROM notes WHERE id = {note} AND deleted_at IS NOT NULL"),
    )
    .await;
    assert_eq!(old_still_deleted, 1, "{KNOWN}：旧行没有被复活");
}

/// 场景 4：**进程重启后的第一轮，任何删除都不生效**（基线不落库）。
///
/// `runtime.rs:8-9`：「基线不落库：进程重启后第一次同步会以『当前文件 + 当前 SQL』重新
/// 建立锚点」。所以首轮的 `old_body` 是空串 → `apply_timers` 里 `starts_of(old)` 为空 →
/// 删除循环直接 `continue`。用户在关掉软件期间从文件里删掉的那一段，首轮**不会被删**，
/// 而且会被重渲染写回文件。
#[tokio::test]
async fn first_round_after_restart_deletes_nothing() {
    let env = env("conflict-restart").await;
    let item = new_item(&env.pool, "写代码").await;

    /* 库里两段，文件里只有一段 —— 正是「关着软件时在编辑器里删掉一段」的形状。
       注意这里**没有先跑一轮**，所以本进程对这个路径还没有基线（= 刚重启）。 */
    let nine = insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;
    let eleven = insert_saved(&env.pool, item, at(env.date, 11, 0), at(env.date, 11, 30), 1800).await;
    rewrite(
        &env,
        TIMERS_HEADING,
        &format!(
            "- [ ] 写代码\n  ```yaml\n  planner:\n    log:\n      - start: {}\n        end: {}\n  ```",
            ts(env.date, 9, 0),
            ts(env.date, 9, 30)
        ),
    );

    services::md_sync::run(&env.pool).await.unwrap();

    // 实测 v0.11.17: 两段都还活着（首轮一条都没删）
    let live = live_records(&env.pool).await;
    assert_eq!(live.len(), 2, "{KNOWN}：首轮不做任何删除");
    assert!(live.iter().any(|(id, _)| *id == nine));
    assert!(live.iter().any(|(id, _)| *id == eleven));
    // 实测 v0.11.17: 被「删掉」的 11:00 又被重渲染写回文件
    assert!(
        body_of(&env, TIMERS_HEADING).contains("11:00:00"),
        "{KNOWN}：首轮之后那段被写回文件"
    );
}

/// 场景 5：整段重写时，**非 Timing 的行逐字保留**（PRD N4 的红线，不许退化）。
///
/// 与上面四条相反：这一条是**保护性**的现状，改坏了才是事故。`write_section` 只替换
/// 「标题行到下一个同级标题之间」的内容，日记里用户手写的段落一个字节都不动。
#[tokio::test]
async fn write_section_keeps_free_text_outside_the_heading_block() {
    let env = env("conflict-section").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    let before = "手写段落甲\n\n#### 备忘\n\n手写段落乙\n";
    let path = file_for(&env);
    std::fs::write(&path, before).unwrap();

    services::md_sync::run(&env.pool).await.unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    // 实测 v0.11.17: 两段手写文字都在，顺序不变
    assert!(text.contains("手写段落甲"), "{KNOWN}：区块外的手写内容必须保留");
    assert!(text.contains("手写段落乙"), "{KNOWN}：区块外的手写内容必须保留");
    assert!(text.contains(TIMERS_HEADING), "区块应被追加到文件末尾");
    assert!(text.contains("写代码"));
    assert!(
        text.find("手写段落甲").unwrap() < text.find("手写段落乙").unwrap(),
        "顺序不变"
    );
    assert!(
        text.find("手写段落乙").unwrap() < text.find(TIMERS_HEADING).unwrap(),
        "区块追加在原有内容之后"
    );
}
