//! 事项标签的 IPC DTO。
//!
//! 放 `models` 而不是仓库里：命令层不得 `use crate::repositories`（L5），而它又要
//! 声明返回类型。仓库只负责 SQL 与行映射。

use serde::{Deserialize, Serialize};

/// 一条事项的标签集合（`camelCase`，与前端 `ItemTags` 逐字对应）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTags {
    pub item_id: i64,
    pub tags: Vec<String>,
}

/// 改名 / 删除标签后的结果：改到了几条事项 + 操作后的全部标签定义。
///
/// 定义一起回传而不是让前端再问一次：标签管理页的树 = 「定义 ∪ 事项上的路径」，
/// 两次请求之间的空窗会让刚删掉的节点闪回一帧。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagMutation {
    /// 被改到（或被删到）的未删除事项条数
    pub items: usize,
    /// 操作完成后的全部标签定义（已归一、已排序）
    pub definitions: Vec<String>,
}
