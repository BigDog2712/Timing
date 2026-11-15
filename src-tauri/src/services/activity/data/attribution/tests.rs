//! `resolve_child_category` 的判据。
//!
//! 前半段是用例表直接照抄需求里的例子 —— 那几行就是「做完」的定义；
//! 后半段钉的是确定性（乱序、同 priority、空白事项分类），这些不钉就会变成
//! 「同一份数据两次读出来分类不同」。

use super::{resolve_child_category, AppCategory, FALLBACK_CATEGORY};

fn cats(entries: &[(&str, i64)]) -> Vec<AppCategory> {
    entries
        .iter()
        .map(|(key, priority)| AppCategory::new(key, *priority))
        .collect()
}

/// chrome 既是学习工具又是娱乐/游戏工具 —— 这就是「一个应用挂多个分类」的全部理由。
const CHROME: &[(&str, i64)] = &[("study", 10), ("work", 20), ("entertainment", 30), ("game", 40)];
const PYCHARM: &[(&str, i64)] = &[("study", 10)];
/// bilibili 的首位是「摸鱼」，所以它在学习事项下显示摸鱼（规则 2），不需要任何覆盖。
const BILIBILI: &[(&str, i64)] = &[("idle", 10), ("entertainment", 20)];
/// bilibili 若也挂了「游戏」，那么在游戏事项下就按规则 1 记游戏。
const BILIBILI_WITH_GAME: &[(&str, i64)] = &[("idle", 10), ("entertainment", 20), ("game", 30)];
const WECHAT: &[(&str, i64)] = &[("social", 10)];

#[test]
fn app_that_has_the_item_category_follows_the_item() {
    assert_eq!(resolve_child_category(&cats(CHROME), Some("study")), "study");
    assert_eq!(resolve_child_category(&cats(CHROME), Some("game")), "game");
    assert_eq!(resolve_child_category(&cats(PYCHARM), Some("study")), "study");
    assert_eq!(
        resolve_child_category(&cats(BILIBILI_WITH_GAME), Some("game")),
        "game"
    );
}

#[test]
fn app_without_the_item_category_falls_back_to_its_first() {
    assert_eq!(resolve_child_category(&cats(WECHAT), Some("game")), "social");
    assert_eq!(resolve_child_category(&cats(BILIBILI), Some("study")), "idle");
}

/// 事项没分类时，规则 1 天然不命中，直接落到应用首位 —— 不需要单独一条分支。
#[test]
fn missing_item_category_uses_the_app_first() {
    assert_eq!(resolve_child_category(&cats(WECHAT), None), "social");
    assert_eq!(resolve_child_category(&cats(CHROME), None), "study");
}

/// 空串与纯空白等同于「没分类」。写死成 `Some("")` 会让规则 1 永远不命中，
/// 看上去行为正确，但只要有个应用恰好挂了空分类键就会静默命中。
#[test]
fn blank_item_category_is_treated_as_missing() {
    assert_eq!(resolve_child_category(&cats(WECHAT), Some("   ")), "social");
}

#[test]
fn app_without_any_category_falls_back_to_other() {
    assert_eq!(
        resolve_child_category(&[], Some("study")),
        FALLBACK_CATEGORY
    );
    assert_eq!(resolve_child_category(&[], None), FALLBACK_CATEGORY);
}

/// 应用分类从库里取出来是 SQL 的返回顺序，不保证按 priority 排。
/// 改坏的样子：取 `app_categories[0]` 而不是 `min_by(priority)` —— 首位会随插入顺序漂移。
#[test]
fn unsorted_input_still_picks_the_lowest_priority() {
    let shuffled = cats(&[("social", 90), ("idle", 10), ("entertainment", 50)]);
    assert_eq!(resolve_child_category(&shuffled, Some("study")), "idle");
}

/// 同 priority 时用 category_key 字典序决胜，保证两端、两次读都得到同一个值。
#[test]
fn equal_priority_is_broken_by_key_for_determinism() {
    let tied = cats(&[("work", 10), ("study", 10)]);
    assert_eq!(resolve_child_category(&tied, Some("game")), "study");
    assert_eq!(
        resolve_child_category(&cats(&[("study", 10), ("work", 10)]), Some("game")),
        "study"
    );
}

/// 规则 1 命中时与 priority 无关：chrome 的「游戏」排最后也仍然记游戏。
#[test]
fn matching_category_wins_regardless_of_priority() {
    let chrome_game_last = cats(&[("study", 1), ("work", 2), ("game", 99)]);
    assert_eq!(resolve_child_category(&chrome_game_last, Some("game")), "game");
}
