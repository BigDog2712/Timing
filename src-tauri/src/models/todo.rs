//! 待办域 DTO（`todo_*` 命令入参 / 出参）。
//!
//! 字段与 `src/types/domain-v020.ts` 的 `Todo` / `TodoPatch` / `TodoListParams` 一一对应
//! （serde `rename_all = "camelCase"`）。实现不得超出契约签名新增字段。

use serde::{Deserialize, Deserializer, Serialize};

/// 待办事项。与 `domain-v020.ts::Todo` 一一对应。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: i64,
    /// 标题（trim 后长度 1-`TODO_TITLE_MAX_LEN`）。
    pub title: String,
    /// [V0.11.3] 绑定的具体事项；null = 还没绑（开始计时时按标题匹配并回填）。
    pub item_id: Option<i64>,
    /// 计划执行时刻；null = 未排期。
    pub planned_at: Option<i64>,
    /// 提醒时刻；null = 无提醒。
    pub remind_at: Option<i64>,
    /// 该提醒已触发时刻；null = 未触发（去重标记，K-19）。
    pub reminded_at: Option<i64>,
    /// 完成时刻；null = 未完成。
    pub done_at: Option<i64>,
    /// 手动排序（升序）。
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// `todo_list` 过滤入参。`from`/`to` 作用于 `planned_at`，语义 `from <= planned_at < to`。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoListParams {
    /// 是否含已完成；默认 false。
    #[serde(default)]
    pub include_done: bool,
    /// 起始（含）。
    #[serde(default)]
    pub from: Option<i64>,
    /// 结束（不含）。
    #[serde(default)]
    pub to: Option<i64>,
}

/// `todo_update` 的部分更新字段。
///
/// `planned_at` / `remind_at` 可显式置 null（清空），故用 `Option<Option<i64>>` +
/// `double_option` 反序列化：字段缺省 → `None`（不改），显式 `null` → `Some(None)`（清空），
/// 有值 → `Some(Some(v))`（改值）。serde 默认无法区分「缺省」与「null」，需此写法。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoPatch {
    #[serde(default)]
    pub title: Option<String>,
    /// [V0.11.3] 改绑/解绑事项：`Some(Some(id))` 改绑、`Some(None)` 解绑、`None` 不动。
    #[serde(default, deserialize_with = "double_option")]
    pub item_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub planned_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub remind_at: Option<Option<i64>>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    /// [V0.3.12] 「当前事项结束后自动开始」（ADR-030）：省略 = 不改。
    #[serde(default)]
    pub auto_start: Option<bool>,
}

/// 把可空字段反序列化为 `Some(None)`（JSON `null`）以区别于缺省（`None`）。
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}
