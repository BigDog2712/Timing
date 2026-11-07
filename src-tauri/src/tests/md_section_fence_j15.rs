//! J15 集成验（设计 §2.9）：别人的代码围栏里有**一行逐字** `#### 事项计时`。
//!
//! 这个形状在 v0.11.18 会把 `find_heading` 的坐标落在别人的围栏里，于是 `write_section`
//! 从那儿替换到下一个标题——**把别人写的内容整段换成我们的渲染结果**，不可逆。
//!
//! 三条断言照 PRD §3.5：围栏那段 `cmp` 逐字节不变；我们的区块仍在原位被更新；
//! 文件里仍只有 1 个真标题（不因为「找不到」就在末尾补第二节）。

use crate::infra::{md_fence, md_file, md_section};
use crate::services;
use crate::tests::md_sync::{at, env, file_for, NOTES_HEADING, TIMERS_HEADING};
use crate::tests::support::{insert_saved, new_item};

#[tokio::test]
async fn j15_foreign_fence_is_byte_identical_after_a_round() {
    let env = env("md-fence-j15").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    /* 围栏放在我方区块**之前**：只有这样「第一个命中」才会落在别人的围栏里。 */
    let prefix = format!("顶部说明段：Timing 会写下面这个区块。\n\n```\n{TIMERS_HEADING}\n```\n");
    let before = format!(
        "{prefix}\n别人的区块，一个字都不许动\n\n{TIMERS_HEADING}\n\n{NOTES_HEADING}\n"
    );
    let path = file_for(&env);
    std::fs::write(&path, &before).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let after = std::fs::read_to_string(&path).unwrap();
    /* ① 逐字节：前缀（顶部说明 + 围栏 + 围栏里那行标题）原样还在。 */
    assert!(after.starts_with(&prefix), "围栏那段被改写了：\n{after}");
    assert!(after.contains("别人的区块，一个字都不许动"));

    let lines: Vec<&str> = after.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, _) =
        md_section::find_heading(&lines, &fences, TIMERS_HEADING).expect("真标题还在");
    let first = lines
        .iter()
        .position(|line| *line == TIMERS_HEADING)
        .expect("围栏里那行仍逐字存在");
    /* ② 真标题仍在围栏之后（我们的区块在原位），不是被追加到文件末尾。 */
    assert!(first < head_idx, "围栏里那行在前，真标题在后");
    assert!(
        lines[..head_idx].contains(&"别人的区块，一个字都不许动"),
        "我们的区块仍在它原本的位置"
    );
    let body = md_file::body_in_text(&after, TIMERS_HEADING).expect("应有我们的区块");
    assert!(body.contains("09:00:00"), "区块被正常更新：{body}");

    /* ③ 只产生 1 个真标题，围栏里那份示例原样保留（合计 2 行同文本）。 */
    assert_eq!(md_section::count_exact(&lines, &fences, TIMERS_HEADING), 1);
    assert_eq!(after.matches(TIMERS_HEADING).count(), 2);
}
