//! 今日汇总：本地事实 → 模型 → Markdown →（可选）写进日记。
//!
//! ## 为什么事实在本地拼
//!
//! 模型只该做「组织语言」，不该做统计。时长、应用名、标签全部来自 SQLite（业务库 +
//! 只读的分析窗库），提示词里的 JSON 因此可复核；模型编出来的数字不会被当成事实
//! 写进用户的日记——它与本地数据对不上时，用户一眼能看出来。
//!
//! ## 落点
//!
//! 复用 md_sync 的第一个「已启用且已配置」落点（root + file），标题用 AI 自己的
//! `daily_heading`。该标题不在 md_sync 的五个 kind 里，所以不会被同步导入覆盖。
//! `daily_enabled = false` 时只回预览，不碰磁盘。

use std::collections::HashMap;

use chrono::Local;
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::app::activity_bridge;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::md_file;
use crate::models::ai::{AiConfig, AiDailySummary};
use crate::platform::clock;
use crate::repositories::{item, item_tags, record};
use crate::services::md_sync::config as md_config;

use super::{client, config as ai_config, prompt};

const MAX_APPS: usize = 20;
const MAX_ITEMS: usize = 30;
/// 不足一分钟的记录不进提示词：只会把 token 花在「1 分钟」这种噪声上。
const MIN_SEC: i64 = 60;

pub async fn generate(pool: &SqlitePool) -> AppResult<AiDailySummary> {
    let (config, key) = ai_config::require_ready(pool).await?;
    let now = clock::now_ms();
    let date = Local::now().date_naive();
    let (from, to) = clock::day_bounds(date);
    let date_text = date.format("%Y-%m-%d").to_string();

    let names: HashMap<i64, String> = item::list(pool, true)
        .await?
        .into_iter()
        .map(|row| (row.id, row.name))
        .collect();
    let tags: HashMap<i64, Vec<String>> = item_tags::list(pool)
        .await?
        .into_iter()
        .map(|row| (row.item_id, row.tags))
        .collect();

    let mut items: Vec<Value> = record::stats_by_item(pool, None, Some(from), Some(to))
        .await?
        .into_iter()
        .filter(|stat| stat.total_sec >= MIN_SEC)
        .map(|stat| {
            json!({
                "name": names
                    .get(&stat.item_id)
                    .cloned()
                    .unwrap_or_else(|| format!("事项 #{}", stat.item_id)),
                "minutes": stat.total_sec / 60,
                "tags": tags.get(&stat.item_id).cloned().unwrap_or_default(),
            })
        })
        .collect();
    items.sort_by_key(|row| -row["minutes"].as_i64().unwrap_or(0));
    items.truncate(MAX_ITEMS);

    let apps: Vec<Value> = activity_bridge::activity_summary(from, to, MAX_APPS as i64)
        .await
        .into_iter()
        .filter(|slice| slice.sec >= MIN_SEC)
        .map(|slice| json!({ "name": slice.app, "minutes": slice.sec / 60 }))
        .collect();

    if items.is_empty() && apps.is_empty() {
        return Ok(AiDailySummary {
            date: date_text,
            markdown: "今天还没有记录到计时或应用使用。".to_string(),
            path: None,
            at: now,
        });
    }

    let payload = json!({ "date": date_text, "items": items, "apps": apps }).to_string();
    let raw = client::build_daily(&config, &key)?
        .chat(prompt::SYSTEM_DAILY, &payload)
        .await?;
    let markdown = prompt::sanitize_markdown(&raw);
    let path = if config.daily_enabled {
        write_to_journal(pool, &config, date, &markdown).await?
    } else {
        None
    };
    Ok(AiDailySummary {
        date: date_text,
        markdown,
        path,
        at: now,
    })
}

/// 找到第一个可写的落点并覆盖 AI 区块。没有落点不算失败（预览本身有价值）。
async fn write_to_journal(
    pool: &SqlitePool,
    config: &AiConfig,
    date: chrono::NaiveDate,
    markdown: &str,
) -> AppResult<Option<String>> {
    let settings = md_config::load(pool).await?;
    let Some(binding) = settings.bindings.iter().find(|binding| {
        binding.enabled && !binding.root.trim().is_empty() && !binding.file.trim().is_empty()
    }) else {
        return Ok(None);
    };
    let path = md_file::resolve_path(&binding.root, &binding.file, date);
    md_file::write_section(&path, &config.daily_heading, markdown)
        .map_err(|err| AppError::new(ErrorCode::IoError, format!("写入日记失败：{err}")))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
