//! 事项标签仓库（`items.tags` 单列 JSON 数组）。
//!
//! ## 存的是**标签路径**，不是活动库的分类键
//!
//! `items.tags` 里直接是 Obsidian 风格的路径（`学习/考公`），显示名就是路径本身；
//! 与活动库的 `study` / `custom:<uuid>` 是两套体系，不读
//! `__category_label_override::` / `__category_color_override::`，改名即改路径。
//! 嵌套只靠路径里的 `/` 表达，**不做树表**：`#学习` 与 `#学习/考公` 是两条独立标签。
//!
//! ## 为什么没有关联表
//!
//! 见 `0017_v01231_item_tags.sql` 文件头：事项整体按行走全额数据包（动态列合并），
//! 加一列即跨端可用；标签只按事项整体读写，没有「按标签反查」的热路径。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::{item_tags::ItemTags, tag_path::normalize_tag_paths};

use crate::models::tag_path::MAX_TAGS;

/// 全部未删除事项的标签（没有标签的事项也返回空数组，前端一次合并，不必二次查）。
pub async fn list(pool: &SqlitePool) -> AppResult<Vec<ItemTags>> {
    let rows: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, tags FROM items WHERE deleted_at IS NULL ORDER BY id ASC")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(item_id, raw)| ItemTags {
            item_id,
            tags: decode(&raw),
        })
        .collect())
}

/// 覆盖一条事项的标签集合，返回**归一后**真正落库的值。
///
/// 返回归一结果而不是 `()`：前端要拿它刷新草稿（用户输入的 `#学习//` 应当变成
/// `学习`），否则输入框里留着的东西与库里不一致，下次保存又原样发一遍。
pub async fn set(
    pool: &SqlitePool,
    item_id: i64,
    tags: &[String],
    now: i64,
) -> AppResult<Vec<String>> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT id FROM items WHERE id = ? AND deleted_at IS NULL")
            .bind(item_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::item_not_found());
    }
    let normalized = normalize(tags)?;
    let raw = serde_json::to_string(&normalized).map_err(AppError::db)?;
    sqlx::query("UPDATE items SET tags = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(raw)
        .bind(now)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(normalized)
}

/// 把一个标签**连同其子树**改名（`学习` → `学业` 同时把 `学习/考公` 变成 `学业/考公`）。
///
/// 返回被改到的事项条数。改名后的路径仍然要过一遍归一：`to` 本身合法并不代表
/// `to + 子段` 还在 4 级 / 64 字以内（把 `a` 改成 `a/b/c` 时，`a/x/y` 会变成 5 级）。
/// 越界的那一条**保持原样**——改名宁可漏掉一条，也不能把用户的标签截断或清空。
pub async fn rename_path(
    pool: &SqlitePool,
    from: &str,
    to: &str,
    now: i64,
) -> AppResult<usize> {
    let rows: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, tags FROM items WHERE deleted_at IS NULL ORDER BY id ASC")
            .fetch_all(pool)
            .await?;
    let mut tx = pool.begin().await?;
    let mut changed = 0_usize;
    for (item_id, raw) in rows {
        let Some(next) = rename_in(&decode(&raw), from, to) else {
            continue;
        };
        write_tags(&mut tx, item_id, &next, now).await?;
        changed += 1;
    }
    tx.commit().await?;
    Ok(changed)
}

/// 删除一个标签**及其子树**，返回被改到的事项条数。
pub async fn delete_path(pool: &SqlitePool, path: &str, now: i64) -> AppResult<usize> {
    let rows: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, tags FROM items WHERE deleted_at IS NULL ORDER BY id ASC")
            .fetch_all(pool)
            .await?;
    let mut tx = pool.begin().await?;
    let mut changed = 0_usize;
    for (item_id, raw) in rows {
        let tags = decode(&raw);
        let kept: Vec<String> = tags
            .iter()
            .filter(|tag| !is_same_or_child(tag, path))
            .cloned()
            .collect();
        if kept.len() == tags.len() {
            continue;
        }
        write_tags(&mut tx, item_id, &kept, now).await?;
        changed += 1;
    }
    tx.commit().await?;
    Ok(changed)
}

/// `tag` 是否就是 `path` 或它的子路径（大小写不敏感，与写入侧去重口径一致）。
fn is_same_or_child(tag: &str, path: &str) -> bool {
    let tag = tag.to_lowercase();
    let path = path.to_lowercase();
    tag == path || tag.starts_with(&format!("{path}/"))
}

fn rename_in(tags: &[String], from: &str, to: &str) -> Option<Vec<String>> {
    let prefix = format!("{from}/");
    let mut changed = false;
    let mut out: Vec<String> = Vec::with_capacity(tags.len());
    for tag in tags {
        let mapped = if tag == from {
            Some(to.to_string())
        } else {
            tag.strip_prefix(&prefix)
                .map(|rest| format!("{to}/{rest}"))
        };
        match mapped {
            Some(path) if crate::models::tag_path::normalize_tag_path(&path).is_ok() => {
                changed = true;
                out.push(path);
            }
            _ => out.push(tag.clone()),
        }
    }
    changed.then(|| normalize_tag_paths(&out, MAX_TAGS).unwrap_or(out))
}

/// 批量写回（同一事务内），`updated_at` 推进由 `trg_items_touch_tags` 负责另一半。
async fn write_tags(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    item_id: i64,
    tags: &[String],
    now: i64,
) -> AppResult<()> {
    let raw = serde_json::to_string(tags).map_err(AppError::db)?;
    sqlx::query("UPDATE items SET tags = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(raw)
        .bind(now)
        .bind(item_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// 读库：坏 JSON 按「没有标签」处理。
///
/// 一行坏数据不该让整个事项管理弹层打不开，也不该把其它事项的标签一起吞掉；
/// 写入侧已经在 `set` 里保证只落合法 JSON，这里的降级只兜历史 / 外部改库。
fn decode(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .ok()
        .and_then(|tags| normalize(&tags).ok())
        .unwrap_or_default()
}

/// Normalize paths consistently with the shared frontend rules and reject over-limit input.
fn normalize(tags: &[String]) -> AppResult<Vec<String>> {
    normalize_tag_paths(tags, MAX_TAGS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::support::{fresh_pool, new_item};

    #[tokio::test]
    async fn set_normalizes_dedupes_and_returns_the_stored_value() {
        let pool = fresh_pool("item-tags-normalize").await;
        let id = new_item(&pool, "写论文").await;
        let stored = set(
            &pool,
            id,
            &[
                " #学习/考公 ".into(),
                "学习//考公/".into(),
                "".into(),
                "/".into(),
                "娱乐".into(),
            ],
            7,
        )
        .await
        .expect("写标签应成功");
        assert_eq!(stored, vec!["学习/考公".to_string(), "娱乐".to_string()]);
        let rows = list(&pool).await.expect("读标签应成功");
        let row = rows.iter().find(|row| row.item_id == id).expect("应有一行");
        assert_eq!(row.tags, stored);
    }

    #[tokio::test]
    async fn rejects_excessive_path_depth_length_and_tag_count() {
        let pool = fresh_pool("item-tags-limits").await;
        let id = new_item(&pool, "限制测试").await;
        let invalid_paths = vec![
            "a/b/c/d/e".to_string(),
            "x".repeat(65),
            format!("{}/x", "a".repeat(33)),
        ];
        for invalid in invalid_paths {
            let result = set(&pool, id, std::slice::from_ref(&invalid), 1).await;
            assert!(result.is_err(), "应拒绝超限标签: {invalid}");
        }
        let too_many = (0..MAX_TAGS + 1)
            .map(|i| format!("标签{i}"))
            .collect::<Vec<_>>();
        assert!(set(&pool, id, &too_many, 1).await.is_err());
    }

    #[tokio::test]
    async fn tags_round_trip_and_empty_set_clears() {
        let pool = fresh_pool("item-tags-roundtrip").await;
        let id = new_item(&pool, "健身").await;
        set(&pool, id, &["健康".into()], 1).await.expect("写");
        assert_eq!(find(&pool, id).await, vec!["健康"]);
        assert!(set(&pool, id, &[], 2).await.expect("清空").is_empty());
        assert!(find(&pool, id).await.is_empty());
    }

    async fn find(pool: &SqlitePool, id: i64) -> Vec<String> {
        list(pool)
            .await
            .expect("读")
            .into_iter()
            .find(|row| row.item_id == id)
            .expect("应有该事项")
            .tags
    }

    #[tokio::test]
    async fn writing_a_missing_item_is_item_not_found() {
        let pool = fresh_pool("item-tags-missing").await;
        let error = set(&pool, 999_999, &["学习".into()], 1)
            .await
            .expect_err("不存在的事项必须报错");
        assert_eq!(error.code, crate::error::ErrorCode::ItemNotFound);
    }

    #[tokio::test]
    async fn tag_write_bumps_updated_at_ms_for_cross_device_merge() {
        let pool = fresh_pool("item-tags-touch").await;
        let id = new_item(&pool, "读书").await;
        let before: i64 = sqlx::query_scalar("SELECT updated_at_ms FROM items WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .expect("读 updated_at_ms");
        set(&pool, id, &["阅读".into()], 3).await.expect("写");
        let after: i64 = sqlx::query_scalar("SELECT updated_at_ms FROM items WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .expect("读 updated_at_ms");
        assert!(after > before, "标签写入必须推进 LWW 时间戳");
    }
}
