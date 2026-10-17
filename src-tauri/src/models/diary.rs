//! 今日日记配置与状态 DTO。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryConfig {
    pub vault_root: String,
    pub diary_relative_dir: String,
    pub diary_file_name_format: String,
    pub editor_path: String,
}

impl Default for DiaryConfig {
    fn default() -> Self {
        Self {
            vault_root: String::new(),
            diary_relative_dir: "1-MemeX/Diary".to_string(),
            diary_file_name_format: "%Y-%m-%d".to_string(),
            editor_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayDiary {
    pub date: String,
    pub path: String,
    pub exists: bool,
    pub config: DiaryConfig,
}
