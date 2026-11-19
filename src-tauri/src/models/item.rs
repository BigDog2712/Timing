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
    /// [0.13.x] 父事项；`None` = 顶层。**深度硬限 2 层**（见 `services::item`）。
    pub parent_id: Option<i64>,
    /// [0.13.x] 0 = 顶层事项，1 = 子事项。冗余存一份是为了「查所有叶子」不必递归。
    pub depth: i64,
    /// [0.13.x] 事项分类（`学习` / `游戏` …）。子记录分类解析的第一条规则要用它。
    pub category_key: Option<String>,
}

/// 新建事项的参数。
///
/// 收成结构体而不是继续加位置参数：`name` / `color` / `category_key` 都是
/// 可空 `&str`，调用点写反了照样能编译。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCreate {
    pub name: String,
    pub color: Option<String>,
    /// 父事项；给了就必须是顶层事项（depth = 0）。
    pub parent_id: Option<i64>,
    /// 事项分类键；与应用的分类集取交集就是子记录的分类（§4 规则 1）。
    pub category_key: Option<String>,
}

/// `update_item` 的部分更新字段。
///
/// `remind_at` 三态：缺省 = 不改；显式 `null` = 清除提醒；值 = 设置提醒。
/// `reminded_at` 不可由前端设置（由后台调度维护）。
/// `parent_id` / `category_key` 同为三态（缺省不改 / null 清空 / 值设置）。
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
    #[serde(default, deserialize_with = "double_option")]
    pub parent_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub category_key: Option<Option<String>>,
}

/// 区分「字段缺省」（`None`）与「显式 null」（`Some(None)`）。
///
/// 泛型而不是给 `i64` / `String` 各写一遍：三态字段会继续增加（`parent_id` 之后就
/// 是 `category_key`），每加一个复制一份 deserializer 迟早会有一份被改坏。
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 三个树/分类字段必须出现在序列化后的 JSON 里（值是 `null` 也算）。
    ///
    /// 前端把它们声明成**可选**（理由见 `domain/models.ts`：30 多处测试夹具在造
    /// `Item` 字面量），所以「后端漏返回」在 TypeScript 那边完全静默 —— 树视图会把
    /// 所有事项当成顶层、切片会把所有子记录归到 `other`。这条用例是那个缺口的唯一补偿：
    /// 它盯的是**序列化后的键名**，`skip_serializing_if` 之类的改动会让它立刻红。
    #[test]
    fn item_tree_fields_are_always_serialized() {
        let item = Item {
            id: 7,
            name: "学习SQL".to_string(),
            color: None,
            status: "active".to_string(),
            is_system: false,
            sort_order: 3,
            remind_at: None,
            reminded_at: None,
            is_pinned: false,
            created_at: 1,
            updated_at: 1,
            parent_id: None,
            depth: 0,
            category_key: Some("study".to_string()),
        };
        let json = serde_json::to_value(&item).expect("serializes");
        for key in ["parentId", "depth", "categoryKey"] {
            assert!(json.get(key).is_some(), "Item JSON 缺 `{key}`：{json}");
        }
        assert_eq!(json["depth"], 0);
        assert_eq!(json["categoryKey"], "study");
        assert!(
            json["parentId"].is_null(),
            "顶层事项的 parentId 必须是 null"
        );
    }
}
