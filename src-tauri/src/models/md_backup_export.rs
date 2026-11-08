//! 备份导出的返回形状（[V0.11.23]）。
//!
//! 单独成文件：`md_sync_cloud.rs` 已经顶到 300 行门禁（v0.11.16 的
//! `md_sync_test_result.rs` 是同一个理由）。

use serde::Serialize;

/// 导出一份备份的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdBackupExport {
    /// `true` = 已写进用户挑的位置；`false` = 用户在选择器里取消了。
    ///
    /// **取消不是失败**：前端不许把它画成红字（`md_saf_pick` 的 `granted` 同口径）。
    pub saved: bool,
    /// 实际建议的文件名（去掉落点前缀后的那份）。前端用它拼「已保存 …」。
    pub name: String,
}
