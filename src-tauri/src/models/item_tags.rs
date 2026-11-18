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
