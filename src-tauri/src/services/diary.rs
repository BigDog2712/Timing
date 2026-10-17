//! 今日日记路径解析与打开服务。

use std::path::{Path, PathBuf};

use chrono::Local;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::clock::now_ms;
use crate::models::diary::{DiaryConfig, TodayDiary};
use crate::repositories::settings;

const KEY_VAULT: &str = "diary.vault_root";
const KEY_DIR: &str = "diary.relative_dir";
const KEY_FORMAT: &str = "diary.file_name_format";
const KEY_EDITOR: &str = "diary.editor_path";

pub async fn get_config(pool: &SqlitePool) -> AppResult<DiaryConfig> {
    let read = |key: &'static str| async move { settings::get_value(pool, key).await };
    Ok(DiaryConfig {
        vault_root: read(KEY_VAULT).await?.unwrap_or_default(),
        diary_relative_dir: read(KEY_DIR)
            .await?
            .unwrap_or_else(|| "1-MemeX/Diary".to_string()),
        diary_file_name_format: read(KEY_FORMAT)
            .await?
            .unwrap_or_else(|| "%Y-%m-%d".to_string()),
        editor_path: read(KEY_EDITOR).await?.unwrap_or_default(),
    })
}

pub async fn set_config(pool: &SqlitePool, config: DiaryConfig) -> AppResult<DiaryConfig> {
    if config.diary_relative_dir.trim().is_empty() {
        return Err(AppError::io("日记目录不能为空"));
    }
    let now = now_ms();
    settings::set_value(pool, KEY_VAULT, config.vault_root.trim(), now).await?;
    settings::set_value(pool, KEY_DIR, config.diary_relative_dir.trim(), now).await?;
    settings::set_value(pool, KEY_FORMAT, config.diary_file_name_format.trim(), now).await?;
    settings::set_value(pool, KEY_EDITOR, config.editor_path.trim(), now).await?;
    get_config(pool).await
}

pub async fn today(pool: &SqlitePool) -> AppResult<TodayDiary> {
    let config = get_config(pool).await?;
    let date = Local::now().date_naive();
    let date_text = date
        .format(&chrono_format(&config.diary_file_name_format))
        .to_string();
    let path = diary_path(&config, &date_text);
    Ok(TodayDiary {
        date: date.to_string(),
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
        config,
    })
}

pub async fn open_today(pool: &SqlitePool) -> AppResult<TodayDiary> {
    let diary = today(pool).await?;
    if !diary.exists {
        return Err(AppError::io(format!("今日日记不存在：{}", diary.path)));
    }
    let path = Path::new(&diary.path);
    if !diary.config.editor_path.trim().is_empty() {
        std::process::Command::new(&diary.config.editor_path)
            .arg(path)
            .spawn()
            .map_err(AppError::io)?;
    } else {
        #[cfg(target_os = "windows")]
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &diary.path])
            .spawn()
            .map_err(AppError::io)?;
        #[cfg(target_os = "macos")]
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(AppError::io)?;
        #[cfg(all(unix, not(target_os = "macos")))]
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(AppError::io)?;
    }
    Ok(diary)
}

fn chrono_format(format: &str) -> String {
    format
        .replace("yyyy", "%Y")
        .replace("MM", "%m")
        .replace("dd", "%d")
}

fn diary_path(config: &DiaryConfig, date_text: &str) -> PathBuf {
    Path::new(&config.vault_root)
        .join(Path::new(&config.diary_relative_dir))
        .join(format!("{date_text}.md"))
}
