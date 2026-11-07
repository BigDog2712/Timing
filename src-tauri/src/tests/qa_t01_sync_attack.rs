//! QA 独立验收 · T01 真实一轮同步攻击（严过关，v0.11.19）。
//!
//! 工程师那 14 条里，「跑一轮真实同步」只有 J15 一条（且只断言了前缀与标题计数）。
//! 本文件补的是主理人点名的五格，全部走 `services::md_sync::run`（不是只调纯函数）：
//!
//! - 洞 2：别人围栏里一行逐字 `#### 事项计时` → 一轮后那段**逐字节不变**、我方区块
//!   原位更新、真标题唯一、手写内容一字不动、SQL 无软删；
//! - 洞 1：围栏内 `# 备注`（J9）与围栏外 `# 备注`（既有语义）各跑两轮，查软删；
//! - P1：同名 2 份 / 标题等级被改 / 目录里抄标题，逐字红字 + SQL 零变化 + 不追加第二节。

use crate::infra::{md_fence, md_file, md_section};
use crate::services;
use crate::tests::md_sync::{at, env, file_for, TIMERS_HEADING};
use crate::tests::support::{insert_saved, new_item, scalar_i64};

const DUP_TEXT: &str = "文件里有 2 个「事项计时」标题，请只留一个。";
const MISMATCH_TEXT: &str = "文件里的「事项计时」标题等级与设置不一致，请改文件或改设置。";
const SOFT_SQL: &str = "SELECT COUNT(*) FROM time_records WHERE deleted_at IS NOT NULL";
const ALIVE_SQL: &str =
    "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL";

/// 洞 2（最高优先）：别人的围栏段逐字节不变，且 SQL 一条都不软删。
#[tokio::test]
async fn qa_attack_hole2_foreign_fence_is_byte_identical_after_a_real_round() {
    let env = env("qa-t01-hole2").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    /* 围栏放在我方区块之前：只有这样「第一个命中」才可能落进别人的围栏里。 */
    let foreign = concat!(
        "顶部说明段：Timing 只管自己那一节。\n",
        "\n",
        "#### 读书\n",
        "别人的手写第一行（一个字都不许动）\n",
        "```\n",
        "#### 事项计时\n", // 整行逐字，围栏内
        "这行是别人的示例文本，不是标题\n",
        "```\n",
        "别人的手写最后一行（一个字都不许动）\n",
        "\n",
    );
    let prefix = format!("{foreign}{TIMERS_HEADING}\n");
    /* 真区块初始留空（避免导入把手写行认领成 SQL 记录），手写内容都放在别人名下。 */
    let tail = "#### 尾声\n尾声手写，不许动\n";
    let before = format!("{prefix}\n{tail}");
    let path = file_for(&env);
    std::fs::write(&path, &before).unwrap();

    assert_eq!(scalar_i64(&env.pool, SOFT_SQL).await, 0);
    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let after = std::fs::read_to_string(&path).unwrap();
    /* ① 别人的整段（从文件开头到真标题行，含围栏 / 逐字标题 / 手写行）逐字节不变。 */
    assert!(after.starts_with(&prefix), "围栏那段被改写了：\n{after}");
    assert!(after.contains("别人的手写第一行（一个字都不许动）"));
    assert!(after.contains("别人的手写最后一行（一个字都不许动）"));
    assert!(after.contains("这行是别人的示例文本，不是标题"));
    assert!(after.contains(tail), "区块之后的手写内容一字不动：\n{after}");

    /* ② 我们的区块仍在原位被更新（不是被追加到末尾）。 */
    let body = md_file::body_in_text(&after, TIMERS_HEADING).expect("真标题还在");
    assert!(body.contains("09:00:00"), "区块被正常更新：{body}");
    let lines: Vec<&str> = after.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, _) = md_section::find_heading(&lines, &fences, TIMERS_HEADING).unwrap();
    let first = lines.iter().position(|l| *l == TIMERS_HEADING).unwrap();
    assert!(first < head_idx, "围栏里那行在前，真标题在后，没有被挪到末尾");

    /* ③ 文件里只有 1 个真标题；围栏里那份示例原样保留。 */
    assert_eq!(md_section::count_exact(&lines, &fences, TIMERS_HEADING), 1);
    assert_eq!(after.matches(TIMERS_HEADING).count(), 2);
    /* ④ SQL 零变化：无软删，且那条 saved 记录还活着。 */
    assert_eq!(scalar_i64(&env.pool, SOFT_SQL).await, 0, "洞 2 不得触发任何软删");
    assert_eq!(scalar_i64(&env.pool, ALIVE_SQL).await, 1);
}

/// 洞 1（J9）：区块内**闭合围栏里**的 `# 备注` 不再截断 → 两轮后软删 0。
#[tokio::test]
async fn qa_attack_hole1_comment_inside_fence_soft_deletes_nothing() {
    let env = env("qa-t01-hole1-in").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;
    let path = file_for(&env);

    /* 第 1 轮：正常导出，建立进程内基线。 */
    let first = services::md_sync::run(&env.pool).await.unwrap();
    assert!(first.errors.is_empty(), "{:?}", first.errors);
    let text1 = std::fs::read_to_string(&path).unwrap();
    assert!(text1.contains("09:00:00"));

    /* 用户在我方区块内（计时段之前）插入一个闭合的 ```yaml 围栏与 YAML 注释。 */
    let marker = format!("{TIMERS_HEADING}\n");
    let inserted = format!("{marker}```yaml\n# 备注：这是合法 YAML 注释\n```\n");
    let text2 = text1.replacen(&marker, &inserted, 1);
    std::fs::write(&path, &text2).unwrap();

    let second = services::md_sync::run(&env.pool).await.unwrap();
    assert!(second.errors.is_empty(), "{:?}", second.errors);
    let after = std::fs::read_to_string(&path).unwrap();
    /* 观察（见验收报告「洞 1」）：插入的 ```yaml 围栏与注释行会被本轮「导入后重新
       渲染」规范化掉——render_expected 只从 SQL 渲染，是 v0.11.18 既有语义，不是
       T01 回归；关键是它**没有软删任何记录**，这才是 J9 要防的「数据丢进库里找不回」。 */

    /* 硬判据：截断消失 → 删除块不动 → 软删 0，计时段仍在（J9 的核心）。 */
    assert_eq!(scalar_i64(&env.pool, SOFT_SQL).await, 0, "围栏内 # 备注 不得软删记录");
    assert_eq!(scalar_i64(&env.pool, ALIVE_SQL).await, 1);
    assert!(after.contains("09:00:00"), "计时段没被截断丢掉：\n{after}");
}

/// 洞 1 的对照格：围栏**外**的 `# 备注` 按既有语义仍是标题，仍会截断区块。
/// 这不是 T01 的回归（PRD §3.2 #2 / 设计 §2.8 明确划在本轮范围外），如实记录残留。
#[tokio::test]
async fn qa_attack_hole1_note_outside_fence_is_known_residual() {
    let env = env("qa-t01-hole1-out").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;
    let path = file_for(&env);

    let first = services::md_sync::run(&env.pool).await.unwrap();
    assert!(first.errors.is_empty(), "{:?}", first.errors);
    let text1 = std::fs::read_to_string(&path).unwrap();

    let marker = format!("{TIMERS_HEADING}\n");
    let inserted = format!("{marker}# 备注\n"); // 裸的、围栏外的 level-1 标题
    let text2 = text1.replacen(&marker, &inserted, 1);
    std::fs::write(&path, &text2).unwrap();

    /* 先确认「围栏外的 # 行仍是标题」这个既有语义没被修过头。 */
    let lines: Vec<&str> = text2.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head, level) = md_section::find_heading(&lines, &fences, TIMERS_HEADING).unwrap();
    assert_eq!(lines[md_section::section_end(&lines, &fences, head, level)], "# 备注");

    let second = services::md_sync::run(&env.pool).await.unwrap();
    assert!(second.errors.is_empty(), "{:?}", second.errors);
    let after = std::fs::read_to_string(&path).unwrap();
    let soft = scalar_i64(&env.pool, SOFT_SQL).await;
    /* 钉住这个残留的确切规模：T02 提频后不许把「软删 1 条」放大成更多，
       也不许悄悄变成「静默改数据」。数字变了说明同步链路被改动，要重新评。 */
    assert_eq!(soft, 1, "既有语义：围栏外的 level-1 标题截断区块 → 软删 1 条");
    assert_eq!(scalar_i64(&env.pool, ALIVE_SQL).await, 0);
    assert!(after.contains("# 备注"), "那行是合法标题，不属于我方区块，不该被改写");
}

/// P1-a：同名标题 2 份 → 报逐字红字、第 1 个被替换、第 2 个逐字节不动、SQL 零变化。
#[tokio::test]
async fn qa_attack_p1_duplicate_reports_verbatim_and_never_touches_sql() {
    let env = env("qa-t01-p1-dup").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    let second_block = "#### 事项计时\n- [ ] 用户手写的第二节\n";
    let before = format!("{TIMERS_HEADING}\n\n{second_block}#### 读书\n");
    let path = file_for(&env);
    std::fs::write(&path, &before).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(
        report.errors.iter().any(|e| e.contains(DUP_TEXT)),
        "落点应出现逐字红字：{:?}",
        report.errors
    );
    let after = std::fs::read_to_string(&path).unwrap();
    assert!(after.contains(second_block), "第 2 个标题及其内容逐字节不动：\n{after}");
    assert_eq!(after.matches(TIMERS_HEADING).count(), 2, "不追加第三节");
    assert!(md_file::body_in_text(&after, TIMERS_HEADING).unwrap().contains("09:00:00"));
    assert_eq!(scalar_i64(&env.pool, SOFT_SQL).await, 0);
    assert_eq!(scalar_i64(&env.pool, ALIVE_SQL).await, 1);
}

/// P1-b：标题等级被改（`####` → `###`）→ 逐字红字、不追加第二节、文件与 SQL 零变化。
#[tokio::test]
async fn qa_attack_p1_mismatch_blocks_without_append_or_sql_change() {
    let env = env("qa-t01-p1-mis").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    let before = "### 事项计时\n- [ ] 用户改过等级的手写内容\n#### 读书\n";
    let path = file_for(&env);
    std::fs::write(&path, before).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(
        report.errors.iter().any(|e| e.contains(MISMATCH_TEXT)),
        "应报逐字红字：{:?}",
        report.errors
    );
    let after = std::fs::read_to_string(&path).unwrap();
    assert_eq!(after, before, "阻断级：本轮一个字节都不写");
    assert_eq!(after.matches(TIMERS_HEADING).count(), 0, "不许在末尾追加第二节");
    assert_eq!(scalar_i64(&env.pool, SOFT_SQL).await, 0);
    assert_eq!(scalar_i64(&env.pool, ALIVE_SQL).await, 1);
}

/// P1-c：目录里抄了标题文本（`### 事项计时`）不误报，真区块照常更新。
#[tokio::test]
async fn qa_attack_p1_toc_line_does_not_false_positive() {
    let env = env("qa-t01-p1-toc").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    let before = format!("### 事项计时\n- [ ] 目录抄的一行\n{TIMERS_HEADING}\n\n#### 读书\n");
    let path = file_for(&env);
    std::fs::write(&path, &before).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "见同名就报红会把同步永久堵死：{:?}", report.errors);
    let after = std::fs::read_to_string(&path).unwrap();
    assert!(after.contains("- [ ] 目录抄的一行"), "目录那节逐字节不动");
    assert!(md_file::body_in_text(&after, TIMERS_HEADING).unwrap().contains("09:00:00"));
    assert_eq!(after.matches(TIMERS_HEADING).count(), 1, "只认第 1 个真标题");
}
