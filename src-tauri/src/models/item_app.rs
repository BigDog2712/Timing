//! 事项 ↔ 应用绑定（`item_app` 表）的 DTO。
//!
//! ## 为什么这张表不存分类
//!
//! 「chrome 在游戏事项里记游戏、在学习事项里记学习」这条规则由**应用自己的分类集**
//! 表达（活动库 `app_category` + `attribution::category` 的 3 条规则）。在这里再存一个
//! 「本事项下的缺省分类」就有了第二套规则，两条打架时无人能判。
//!
//! ## `app_key` 的口径
//!
//! 必须是**活动库侧归一后的键**（`sessions.app_key` 的同一个值：Windows 是小写 exe，
//! 安卓是包名）。归一函数只有那一处，本层只做 `trim` —— 在这里再实现一遍归一，
//! 就会出现「绑定写进去的键和会话读出来的键永远对不上」这种零报错的失效。

use serde::{Deserialize, Serialize};

/// 一条「事项绑定了某个应用」的记录。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ItemApp {
    pub item_id: i64,
    pub app_key: String,
    /// 1 = 计入该事项的子记录；0 = 仅记录绑定但不计入（观察用）。
    pub track: i64,
}

/// 绑定参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAppBind {
    pub item_id: i64,
    pub app_key: String,
    /// 缺省 1：绝大多数绑定都要计入子记录。
    #[serde(default = "default_track")]
    pub track: Option<i64>,
}

fn default_track() -> Option<i64> {
    Some(1)
}
