//! 通用泛型 DTO。

use serde::Serialize;

/// 分页结果（IPC-CONTRACT-v2 §5.6）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paginated<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
    pub has_more: bool,
}

impl<T> Paginated<T> {
    pub fn new(items: Vec<T>, total: i64, page: i64, limit: i64) -> Self {
        Self {
            items,
            total,
            page,
            limit,
            has_more: page * limit < total,
        }
    }
}
