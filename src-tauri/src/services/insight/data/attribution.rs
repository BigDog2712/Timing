//! 子记录的分类解析。
//!
//! ## 只有 3 条规则（这是全部）
//!
//! ```text
//! 1. 事项分类 ∈ 应用的分类集  → 事项分类        // chrome 在「游戏」事项里记游戏
//! 2. 应用的分类集非空         → 首位（priority 最小）  // wechat 只有社交 → 社交
//! 3.                          → "other"
//! ```
//!
//! ## 为什么不需要「上下文覆盖」与「固定标签」
//!
//! 需求里出现过两个看似矛盾的现象：chrome 在「游戏」事项里记**游戏**（跟随上下文），
//! wechat 在「游戏」事项里记**社交**（不跟随）。用「应用挂多个分类 + 首位兜底」
//! 就同时解释了：
//!
//! - chrome 的分类集含「游戏」→ 规则 1 命中 → 游戏；
//! - wechat 的分类集只有「社交」，不含「游戏」→ 规则 2 → 首位＝社交。
//!
//! 上一版设计里的 `pinned` 标志与 `(应用, 上下文)` 覆盖行因此全部删掉：它们能表达的
//! 东西，这两条已经表达了；多一套规则就多一处「两条规则打架时无人能判」。
//!
//! ## 一个刻意的取舍
//!
//! 规则 2 只取首位，**不**取「优先级最高的非空分类」之外的任何启发式。用户想改判
//! 某一次记录，走 `block_segment_override`（单次覆盖），而不是去调全局顺序 ——
//! 后者会让历史记录的分类跟着漂移。

/// 应用的一条分类绑定。`priority` 越小越靠前，最小者即「分类首位」。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppCategory {
    pub category_key: String,
    pub priority: i64,
}

impl AppCategory {
    pub fn new(category_key: &str, priority: i64) -> Self {
        Self {
            category_key: category_key.to_string(),
            priority,
        }
    }
}

/// 未归类的兜底键。与 `classification` 种子里的 `other` 同一个值，不能另起一个。
pub const FALLBACK_CATEGORY: &str = "other";

/// 解析一个子记录（应用切片）的分类。纯函数：所有输入显式传入。
///
/// `app_categories` 允许乱序 —— 函数内部按 `(priority, category_key)` 取最小，
/// 用一个确定的 tiebreak，避免「两条同 priority 的分类谁排前面」变成插入顺序的函数。
pub fn resolve_child_category(
    app_categories: &[AppCategory],
    item_category: Option<&str>,
) -> String {
    let item_category = item_category.map(str::trim).filter(|text| !text.is_empty());

    if let Some(item_category) = item_category {
        if app_categories
            .iter()
            .any(|entry| entry.category_key == item_category)
        {
            return item_category.to_string();
        }
    }

    let first = app_categories
        .iter()
        .min_by(|left, right| {
            left.priority
                .cmp(&right.priority)
                .then_with(|| left.category_key.cmp(&right.category_key))
        });
    match first {
        Some(entry) => entry.category_key.clone(),
        None => FALLBACK_CATEGORY.to_string(),
    }
}

/* [0.13.x] 子记录切片：块 ∩ 事实 → 按应用分段并解析分类。
   与  分开文件：那一个是「一条规则」，这一层是「怎么把
   时间轴切出来」，两者的判据完全不相干。 */
pub mod slice;

#[cfg(test)]
mod tests;
