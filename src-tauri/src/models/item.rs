//! 事项域 DTO。

use serde::{Deserialize, Deserializer, Serialize};

/// 事项（归类主体）。字段与 `domain.ts::Item` 一一对应。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    /// "active" | "archived"
    pub status: String,
    /// true 仅「未归类」(id=1)；不可删除 / 归档。
    pub is_system: bool,
    pub sort_order: i64,
    /// [V0.2.0] 事项提醒时刻（epoch 毫秒）；null = 无提醒。
    pub remind_at: Option<i64>,
    /// [V0.2.0] 该提醒已触发时刻；null = 未触发（后台调度去重标记，K-19）。
    pub reminded_at: Option<i64>,
    /// [V0.2.0] 固定任务 / 常用事项。
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// `update_item` 的部分更新字段。
///
/// `remind_at` 三态：缺省 = 不改；显式 `null` = 清除提醒；值 = 设置提醒。
/// `reminded_at` 不可由前端设置（由后台调度维护）。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub remind_at: Option<Option<i64>>,
    #[serde(default)]
    pub is_pinned: Option<bool>,
}

/// 区分「字段缺省」（`None`）与「显式 null」（`Some(None)`）。
fn double_option<'de, D>(de: D) -> Result<Option<Option<i64>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<i64>::deserialize(de).map(Some)
}
