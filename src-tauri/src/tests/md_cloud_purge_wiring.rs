//! 闸⑥（留底才许删）的**接线**判据：`run_folder` 递给 `remove_one` 的留底函数必须恒为
//! `md_backup::save_checked` 本身，不许被换成恒真闭包或「调一下再 true」。
//!
//! ## 为什么这一层只能用源码文本断言，而不是真端到端
//!
//! 备份根 `md_backup::ROOT` 是**进程级 `OnceLock`**：同一进程内没法按用例把它重定向到
//! 临时目录。「留底失败 → 文件仍在」这一档因此只能靠 `remove_one` 的 `save` **参数注入**
//! 造出来（`purge/folder.rs` 里那条 `|_, _| false` 用例）。注入能证「失败了不删」，却
//! **证不了「生产路径传的到底是谁」** —— 这是两个不同的命题，而后者才是闸⑥ 本体：
//!
//! 把 `purge/mod.rs:166` 的 `crate::infra::md_backup::save_checked` 换成
//! `|p, t| { md_backup::save(p, t); true }`，**编译照过、全部用例照绿**（注入那条测的是
//! `remove_one`，不是 `run_folder` 传了什么），而「留底才许删」已经退化成「调了一下函数」。
//! 本地删除是**永久删除**（Windows 直接 DeleteFile，不进回收站），本地目录模式下这份甚至
//! 可能是主人网盘里的文件 —— 这一层不设判据，等于核心闸门无人看守。
//!
//! 这不是偷懒：同目录的 `purge_is_wired_into_both_rounds` 已经开了同样的先例（挂点被删/
//! 被注释只能机验源码文本）。两个真端到端的格子（QA 报的 I13e 两格）各开一个独立进程手验，
//! 那是唯一能造出「真备份根 + 真坏目录」的办法，代价是进不了 CI；本条是它的常驻替代。
//!
//! ## 自证能红（变异步骤，本轮真跑过一次）
//!
//! 把 `purge/mod.rs` 里那句
//! `folder::remove_one(&cand.path, &cand.bytes, crate::infra::md_backup::save_checked)`
//! 改成 `folder::remove_one(&cand.path, &cand.bytes, |p, t| { crate::infra::md_backup::save(p, t); true })`
//! （注意 `mod.rs` 没有 `use crate::infra::md_backup;`，所以变异必须写全路径才编得过；
//! 写成裸 `md_backup::save` 是 `E0433` 编译错，不是本条的判据在起作用）：
//! 本条必须**同时报两处** —— ①「留底参数不是 `save_checked`」；② 负向 needle
//! `md_backup::save(` 与 `|p, t|` 各命中 1 行。所以下面把问题**收集起来最后一起断言**，
//! 否则第一处 panic 会把第二处挡住，「红两处」就成了没验过的说法。
//! `cp` 还原后必须重新变绿。红→绿的实测结果写在当轮提交说明里。

/// 只看非注释行：`//` 行里出现这些 needle 是合法的（本文件的文档就在写它们）。
/// 与 `purge_is_wired_into_both_rounds` 的 `calls()` 同一套口径，便于后人一起改。
fn code_lines(source: &str) -> impl Iterator<Item = &str> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("//"))
}

/// 「留底」这一格必须焊死在 `save_checked` 上。
///
/// 变异自检（红→绿）：见模块头「自证能红」——把留底参数换成
/// `|p, t| { crate::infra::md_backup::save(p, t); true }`，本用例红；`cp` 还原后绿。
#[test]
fn folder_round_passes_save_checked_as_the_backup_argument() {
    let source = include_str!("../services/md_cloud/purge/mod.rs");
    /* 问题收集起来最后一起报：任何一处 panic 都会挡住后面的判据，
       而「红在错的地方 / 只红一处」正是本项目反复栽的坑。 */
    let mut problems: Vec<String> = Vec::new();

    /* ① 正向：全文件只许有一处 `remove_one(` 调用，且它的留底参数就是 `save_checked`。
       多一处调用 = 多一条绕过闸⑥ 的路；参数不是一个常量函数 = 判据失效。 */
    let calls: Vec<&str> = code_lines(source)
        .filter(|line| line.contains("remove_one("))
        .collect();
    if calls.len() != 1 {
        problems.push(format!(
            "remove_one 只许有一处调用（多一处就多一条绕过闸⑥ 的路），实际 {} 处：{calls:?}",
            calls.len()
        ));
    }
    if let Some(call) = calls.first() {
        if !call.contains("md_backup::save_checked") {
            problems.push(format!("留底参数必须是 md_backup::save_checked 本身，实际是：{call}"));
        }
    }

    /* ② 负向：不许把留底包成闭包。这五个 needle 是最小覆盖，每一个都对应一种「看着还行、
       其实闸⑥ 没了」的写法，且都**不会**误伤正确写法（`save_checked` 里没有 `save(`）：
       - `md_backup::save(`  ：直接调 `save` 再自己 return true —— 也就是 QA 报的那个变异；
       - `|p, t|` / `|p,t|`  ：把留底写成双参闭包（「调完就 true」必然落在这个形状里，
                               `remove_one` 的签名决定了闭包只能接两个参数）；
       - `|_, _| true`       ：连参数都不看、恒真 —— 闸⑥ 退化成「什么都没做」；
       - `|_,_| true`        ：同上，少一个空格的手滑写法。
       增量改动若真需要一个本地闭包，请把 needle 与理由一起改，别默默删掉这一组。 */
    for needle in [
        "md_backup::save(",
        "|p, t|",
        "|p,t|",
        "|_, _| true",
        "|_,_| true",
    ] {
        let hits: Vec<&str> = code_lines(source)
            .filter(|line| line.contains(needle))
            .collect();
        if !hits.is_empty() {
            problems.push(format!(
                "不许出现 `{needle}` 这种把留底包成闭包的写法（闸⑥ 会退化成「调了一下」）：{hits:?}"
            ));
        }
    }

    assert!(
        problems.is_empty(),
        "闸⑥ 接线判据失败（共 {} 处）：\n{}",
        problems.len(),
        problems.join("\n")
    );
}
