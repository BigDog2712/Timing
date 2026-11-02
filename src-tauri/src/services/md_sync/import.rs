//! Markdown → SQL：把用户对区块的编辑落到数据库。
//!
//! ## 只处理「基线 → 现在」的差异
//!
//! 同步器把上一次写出的区块内容当作基线。导入时同时拿到**旧区块**与**新区块**：
//! - 新增的清单项 / 表格行 → 新建；
//! - 改过的起止时间 / 正文 → 更新；
//! - 消失的清单项 / 表格行 → 软删。
//!
//! 这样即使文件是「今天日记」而库里还有别的日期的记录，也不会因为某条记录没出现在
//! 本节里就被误删——删除只发生在「基线里本来有、现在没了」的行上。
//!
//! **待办区块是唯一的例外：它一行都不删。** 那一节是过滤后的视图（排除今天要执行的、
//! 排除已完成的），「文件里没有」说明不了用户想删它，理由见 `import/todos.rs`。
//!
//! ## 分文件
//!
//! 计时区块的对位 / 删除 / 实时占位段判定在 `import/timers.rs`，待办区块在
//! `import/todos.rs`（单文件 ≤300 行，也因为那两部分语义密度高、值得各自一篇注释）；
//! 本文件放便利贴、种类分发与三者共用的工具。

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::constants::{ITEM_NAME_MAX_LEN, NOTE_CONTENT_MAX_LEN};
use crate::models::md_sync::MdSyncKind;
use crate::models::note::NoteGeometry;
use crate::platform::clock::now_ms;
use crate::repositories::item as item_repo;
use crate::repositories::md_sync as repo;
use crate::repositories::note as note_repo;

use super::format;

mod timers;
mod todos;

pub use timers::apply_timers;
pub use todos::apply_todos;

/// 按数据种类分发（`mod.rs` 只调这里，避免它自己长出一串 match、越过 300 行）。
pub async fn by_kind(
    pool: &SqlitePool,
    kind: MdSyncKind,
    date: NaiveDate,
    old_body: &str,
    new_body: &str,
) -> AppResult<ImportStats> {
    let stats = match kind {
        MdSyncKind::Timers => apply_timers(pool, date, old_body, new_body).await?,
        MdSyncKind::Notes => apply_notes(pool, old_body, new_body).await?,
        MdSyncKind::Todos => apply_todos(pool, date, old_body, new_body).await?,
    };
    /* [V0.4.1] 导入是**唯一会按用户手改删数据**的路径（默认软删）。留一行现场：
    事后能看出「哪次同步删了几条」，而不是只看到记录少了一条。 */
    if stats.total() > 0 {
        crate::log_info!(
            "md import {kind:?}: created={} updated={} deleted={}",
            stats.created,
            stats.updated,
            stats.deleted
        );
    }
    Ok(stats)
}

/// 导入结果（只统计真正发生变化的行）。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ImportStats {
    pub created: u32,
    pub updated: u32,
    pub deleted: u32,
}

impl ImportStats {
    pub fn total(self) -> u32 {
        self.created + self.updated + self.deleted
    }
}

/// 应用便利贴表格的编辑。
pub async fn apply_notes(
    pool: &SqlitePool,
    old_body: &str,
    new_body: &str,
) -> AppResult<ImportStats> {
    let old = format::parse_notes(old_body);
    let new = format::parse_notes(new_body);
    if old == new {
        return Ok(ImportStats::default());
    }

    let now = now_ms();
    let mut stats = ImportStats::default();
    let mut cache = HashMap::new();
    let old_ids: HashSet<i64> = old.iter().filter_map(|row| row.id).collect();
    let new_ids: HashSet<i64> = new.iter().filter_map(|row| row.id).collect();

    for row in &new {
        let content = truncate_chars(row.content.trim(), NOTE_CONTENT_MAX_LEN);
        let item_id = match row.item.as_deref() {
            Some(name) if !name.trim().is_empty() => {
                Some(ensure_item(pool, name.trim(), &mut cache).await?)
            }
            _ => None,
        };

        let existing = match row.id {
            Some(id) => note_repo::find_by_id(pool, id).await?,
            None => None,
        };

        match existing {
            Some(note) => {
                if note.content != content || note.item_id != item_id {
                    repo::update_note_from_sync(pool, note.id, item_id, &content, now).await?;
                    stats.updated += 1;
                }
            }
            None => {
                if content.is_empty() {
                    continue;
                }
                note_repo::insert(
                    pool,
                    item_id,
                    &content,
                    NoteGeometry {
                        pos_x: 160.0,
                        pos_y: 160.0,
                        width: 280.0,
                        height: 200.0,
                    },
                    now,
                )
                .await?;
                stats.created += 1;
            }
        }
    }

    for id in old_ids.difference(&new_ids) {
        if repo::soft_delete_note(pool, *id, now).await? > 0 {
            stats.deleted += 1;
        }
    }

    Ok(stats)
}

/// 找同名事项；没有就建。名称截到事项长度上限，避免一条坏数据中断整次导入。
pub(super) async fn ensure_item(
    pool: &SqlitePool,
    raw_name: &str,
    cache: &mut HashMap<String, i64>,
) -> AppResult<i64> {
    let name = normalize_item_name(raw_name);
    if let Some(id) = cache.get(&name) {
        return Ok(*id);
    }
    let id = match item_repo::find_by_name(pool, &name).await? {
        Some(item) => item.id,
        None => crate::services::item::create(pool, &name, None).await?.id,
    };
    cache.insert(name, id);
    Ok(id)
}

/// 事项名的唯一规范化入口（`format` 里解析出的名字、库里的名字都过这里比较）。
pub(super) fn normalize_item_name(raw: &str) -> String {
    let trimmed = raw.replace(['\n', '\r'], " ").trim().to_string();
    let truncated = truncate_chars(&trimmed, ITEM_NAME_MAX_LEN);
    if truncated.is_empty() {
        "未归类".to_string()
    } else {
        truncated
    }
}

pub(super) fn truncate_chars(raw: &str, max: usize) -> String {
    if raw.chars().count() <= max {
        raw.to_string()
    } else {
        raw.chars().take(max).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_total_counts_all_operations() {
        let stats = ImportStats {
            created: 1,
            updated: 2,
            deleted: 3,
        };
        assert_eq!(stats.total(), 6);
    }

    #[test]
    fn names_are_trimmed_and_capped() {
        assert_eq!(normalize_item_name("  A  "), "A");
        let long = "x".repeat(ITEM_NAME_MAX_LEN + 10);
        assert_eq!(
            normalize_item_name(&long).chars().count(),
            ITEM_NAME_MAX_LEN
        );
        assert_eq!(normalize_item_name("   "), "未归类");
    }
}
