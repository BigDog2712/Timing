//! 分类目录的对外形状（`list_category_catalog` 的返回；[0.14] 两窗分类选用）。
//!
//! **哑管道**：这里只有六组 KV 原始行，不做任何合并 / 排序 / 标签解析 ——
//! 那些语义在前端 `src/windows/shared/classification/categoryCatalog.ts` 唯一实现，
//! 后端一旦开始"帮忙"合并，两窗各自的展示规则就没有注入点了。

use serde::Serialize;

/// settings KV 的一行（key/value 原样透传，不带前缀剥离——前端按前缀自己切）。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CategorySettingRow {
    pub key: String,
    pub value: String,
}

/// 六组原始行。每个数组的 key 都带各自的前缀（`__custom_category::` 等）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCatalogDto {
    pub definitions: Vec<CategorySettingRow>,
    pub deleted: Vec<CategorySettingRow>,
    pub label_overrides: Vec<CategorySettingRow>,
    pub color_overrides: Vec<CategorySettingRow>,
    pub app_overrides: Vec<CategorySettingRow>,
    pub web_overrides: Vec<CategorySettingRow>,
}

impl CategoryCatalogDto {
    /// 手机端桩：`services::insight` 整棵 `#[cfg(desktop)]`，安卓上没有活动库可读，
    /// 回空目录（前端候选只剩内置键 + 当前值兜底）。
    pub fn empty() -> Self {
        Self {
            definitions: Vec::new(),
            deleted: Vec::new(),
            label_overrides: Vec::new(),
            color_overrides: Vec::new(),
            app_overrides: Vec::new(),
            web_overrides: Vec::new(),
        }
    }
}
