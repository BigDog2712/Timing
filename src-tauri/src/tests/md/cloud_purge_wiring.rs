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
//! 本条会把**所有**命中的问题一起报出来（不写死条数：正负两类判据各自命中多少就报多少）。
//! 为什么非要「收集后一起断言」：连着写 `assert` 时第一处 panic 会把后面的判据全挡住，
//! 于是「多判据都红」永远是没验过的说法 —— 我这版第一稿就是先 `assert_eq` 再 `assert`，
//! 自测变异只报了 1 处才发现。
//!
//! ## 换参数名绕不过去（有一条断言不看 needle）
//!
//! needle 有个天然弱点：`|p, t| { …save_checked(a, b); true }` 只要把参数改成 `|a, b|`，
//! 五个 needle 与正向断言**全都穿过去**（`save_checked` 还在行里、`save(` 不匹配
//! `save_checked(`、`|p, t|` 不匹配 `|a, b|`）—— 而它恰恰是最贴近真实的退化：留底调了、
//! 返回值丢了。所以另有一条**不看 needle、只看竖线**的断言：正确写法那一行本来一个 `|`
//! 都没有（递进去的是函数本身，不是闭包），任何闭包都会带竖线、不管参数叫什么名。
//! 那 5 个 needle 仍保留作纵深（挡「参数没换但文件别处又冒出恒真闭包」这种更绕的形状）。
//!
//! `cp` 还原后必须重新变绿。红→绿的实测结果写在当轮提交说明里。
//!
//! ## 第二条：备份根注入（`app/bootstrap.rs:74`）——比闸⑥ 更上游的那一环
//!
//! 这条链有四环，任何一环松掉，「留底才许删」都会**静默**失效（不报错、不删、水位不动）：
//!
//! 1. `app/bootstrap.rs:74` → `md_backup::set_root(data_root.join("backups").join("md"))`
//!    —— 全仓**唯一**的生产注入点（另一处是 `tests/md_cloud_purge.rs:33` 的测试自设）；
//! 2. `infra/md_backup.rs:132` → `save_checked` 第一句是
//!    `let Some(root) = ROOT.get() else { return false };`，`ROOT` 是 `OnceLock`，
//!    没人注入就**恒 false**；
//! 3. `services/md_cloud/purge/folder.rs:168` → `if !save(path, &text) { return Err(NoBackup) }`；
//! 4. `purge/mod.rs:166` 把它接到 `remove_one` 上（就是上面第一条用例守的那一格）。
//!
//! **删掉第 1 环的后果**：654 条照旧全绿（每个 purge 用例都自己 `set_root`，`tests/` 里
//! `bootstrap` 零命中），而真机上 T04 一份都不删、不报错、水位不推进，日志安静刷
//! `skip=no_backup` —— 用户以为「本来就没东西可清理」。这一环比闸⑥ 更危险：闸⑥ 错了至少
//! 还有人盯着，注入点错了整条功能无声死掉。
//!
//! **为什么也不能真端到端**：`ROOT` 同样是进程级 `OnceLock`，且 `bootstrap` 要 Tauri
//! `AppHandle` 与真实 `data_root`，同进程内造不出来 —— 与闸⑥ 同因，先例仍是
//! `purge_is_wired_into_both_rounds`。
//!
//! **自证能红**：注释掉 `bootstrap.rs:74` → 本条红、**只有本条红**（其余照旧绿）；还原后
//! 全绿。本轮实测记录见提交说明。

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
    let source = include_str!("../../services/md_cloud/purge/mod.rs");
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
        /* ③ 不看 needle 的那条：正确写法这一行没有任何 `|`。见模块头「换参数名绕不过去」。 */
        if call.contains('|') {
            problems.push(format!(
                "`remove_one` 的调用那一行不许出现 `|`：正确写法是直接传 `md_backup::save_checked`，\
                 任何闭包（不管参数叫什么名）都在把闸⑥ 退化成「调了一下」：{call}"
            ));
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

/// 备份根必须在启动时注入、且落在 `backups/md` —— `ROOT` 没人设，闸⑥ 恒 false。
///
/// 链条与后果见模块头「第二条」；这里只落两条判据，都走源码文本：
/// 1. `bootstrap.rs` 非注释行里 `md_backup::set_root(` **恰好 1 处**：0 处 = `ROOT` 永不
///    注入、整条 T04 静默死；多 1 处 = 有第二条注入路径（若落点不同，留底与 `KEEP=30`
///    的清理会分家）；
/// 2. 那一行必须含 `data_root.join("backups").join("md")`：落点不许漂。
///
/// 块注释风险已核：`grep -n set_root src-tauri/src/app/bootstrap.rs` 只有 `:74` 一行，
/// 该文件 9 处 `/* … */` 里都没有这个字符串，所以 `code_lines()` 只滤 `//` 不会误红。
///
/// 变异自检（红→绿）：注释掉 `bootstrap.rs:74` → 本条红且只有本条红；还原后绿。
#[test]
fn bootstrap_injects_the_backup_root_that_gates_every_delete() {
    let source = include_str!("../../app/bootstrap.rs");
    let mut problems: Vec<String> = Vec::new();

    let calls: Vec<&str> = code_lines(source)
        .filter(|line| line.contains("md_backup::set_root("))
        .collect();
    if calls.len() != 1 {
        problems.push(format!(
            "`md_backup::set_root(` 只许有一处（0 处 = ROOT 永不注入、闸⑥ 恒 false；\
             多一处 = 有第二条注入路径），实际 {} 处：{calls:?}",
            calls.len()
        ));
    }
    if let Some(call) = calls.first() {
        if !call.contains(r#"data_root.join("backups").join("md")"#) {
            problems.push(format!(
                "留底根必须落在 data_root/backups/md（要与 KEEP=30 的清理同一处），实际是：{call}"
            ));
        }
    }

    assert!(
        problems.is_empty(),
        "备份根注入判据失败（共 {} 处）：\n{}",
        problems.len(),
        problems.join("\n")
    );
}
