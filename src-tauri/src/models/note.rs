//! 便利贴域 DTO（`note_*` 命令入参 / 出参）。
//!
//! 字段与 `src/types/domain-v020.ts` 的 `Note` / `NotePatch` / `NoteCreateParams`
//! 一一对应（serde `rename_all = "camelCase"`）。实现不得超出契约签名新增字段。

use serde::{Deserialize, Deserializer, Serialize};

/// 便利贴几何（逻辑像素；`pos_x` / `pos_y` / `width` / `height`）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NoteGeometry {
    pub pos_x: f64,
    pub pos_y: f64,
    pub width: f64,
    pub height: f64,
}

/// 便利贴几何的**部分**更新（`None` = 不改动该维度）。汇总为结构体以避免过长参数列表。
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct NoteGeometryPatch {
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

/// 便利贴。与 `domain-v020.ts::Note` 一一对应（一窗一行，label = `note-{id}`）。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    /// 挂靠事项 id；null = 独立便签（AC-63：仅关联一个或解绑）。
    pub item_id: Option<i64>,
    /// 正文（纯文本，保留换行；长度 ≤ `NOTE_CONTENT_MAX_LEN`）。
    pub content: String,
    /// 逻辑像素 x（非物理像素，K-15）。
    pub pos_x: f64,
    /// 逻辑像素 y。
    pub pos_y: f64,
    /// 逻辑像素宽（硬钳制 [160, 900]）。
    pub width: f64,
    /// 逻辑像素高（硬钳制 [120, 900]）。
    pub height: f64,
    /// 窗口当前是否打开（启动据此恢复，K-14）。
    pub is_open: bool,
    /// 是否置顶（`always_on_top`；AC-64 默认 true，ADR-019 起持久化）。
    ///
    /// 语义是**窗口层级**而非列表排序：true → 便利贴浮在普通窗口之上；
    /// 用户主动取消后落 0，重开窗口沿用该值。
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// `note_create` 入参（只建数据行，不建窗口；窗口由 `open_note_window` 负责）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCreateParams {
    #[serde(default)]
    pub item_id: Option<i64>,
    pub content: String,
    pub pos_x: f64,
    pub pos_y: f64,
    pub width: f64,
    pub height: f64,
}

/// `note_update` 的部分更新字段。
///
/// `item_id` 三态：缺省 = 不改；显式 `null` = 解绑为随记；值 = 改挂靠（AC-63）。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub item_id: Option<Option<i64>>,
    #[serde(default)]
    pub pos_x: Option<f64>,
    #[serde(default)]
    pub pos_y: Option<f64>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    /// 置顶开关（AC-64）。缺省 = 不改；由窗口层 `set_always_on_top` 即时生效。
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
