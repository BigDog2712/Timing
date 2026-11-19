//! 事项标签的写入规则（仓库之上的一层薄壳）。
//!
//! 命令层不得直接依赖仓库（L5），而标签确实只有几个动作：读全量 / 覆盖写一条 /
//! 改名 / 删除 / 维护「空标签」的定义行。这一层是那条分层边界的落点。
//!
//! ## 定义行为什么存在
//!
//! 标签的自然归属是 `items.tags`，但**空标签没有事项可以挂**。管理页里新建一个
//! `学习/考公` 之后，如果它还没被任何事项引用，下一次读盘它就消失了 —— 用户会认为
//! 「新建没生效」。所以另存一组定义行：`settings` 表的 `tag.def.<路径>`（值恒为 `1`），
//! 随业务库一起同步（`BUSINESS_TABLES` 里 settings 是 KeyLww），不新增表也不新增迁移。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::item_tags::{ItemTags, TagMutation};
use crate::models::tag_path::normalize_tag_path;
use crate::repositories::item_tags;
use crate::repositories::settings as settings_repo;

/// 标签定义行的键前缀（`tag.def.学习/考公`）。
pub const TAG_DEFINITION_PREFIX: &str = "tag.def.";

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<ItemTags>> {
    item_tags::list(pool).await
}

pub async fn set(
    pool: &SqlitePool,
    item_id: i64,
    tags: &[String],
    now: i64,
) -> AppResult<Vec<String>> {
    item_tags::set(pool, item_id, tags, now).await
}

/// 全部标签定义（已归一化）。坏键跳过 —— 它只代表「没有事项引用也要存在」的那部分，
/// 读不出来就当没有，不该让整个管理页打不开。
pub async fn definitions(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let mut paths = definition_paths(pool).await?;
    paths.sort();
    Ok(paths)
}

/// 归一 + **拒绝空路径**。
///
/// `normalize_tag_path("")` 是合法的（返回空串）—— 对「一个事项没有标签」是对的，
/// 但对「建一个标签」就是错的：空串会写出 `tag.def.` 这种键，界面里多一个看不见的
/// 空标签，而且改名 / 删除都指向不到它。所以这一层单独把关。
fn require_tag_path(raw: &str) -> AppResult<String> {
    let path = normalize_tag_path(raw)?;
    if path.is_empty() {
        return Err(AppError::new(
            crate::error::ErrorCode::InvalidTagPath,
            "标签不能为空",
        ));
    }
    Ok(path)
}

/// 新建一个（可能还没有事项引用的）标签，返回定义全集。
pub async fn create_definition(
    pool: &SqlitePool,
    path: &str,
    now: i64,
) -> AppResult<Vec<String>> {
    let path = require_tag_path(path)?;
    settings_repo::set_value(pool, &definition_key(&path), "1", now).await?;
    definitions(pool).await
}

/// 改名（含子树）：事项上的路径与定义行一起改。
pub async fn rename(pool: &SqlitePool, from: &str, to: &str, now: i64) -> AppResult<TagMutation> {
    let from = require_tag_path(from)?;
    let to = require_tag_path(to)?;
    if from == to {
        return Ok(TagMutation {
            items: 0,
            definitions: definitions(pool).await?,
        });
    }
    let items = item_tags::rename_path(pool, &from, &to, now).await?;
    for path in definition_paths(pool).await? {
        let Some(mapped) = map_path(&path, &from, &to) else {
            continue;
        };
        settings_repo::delete_key(pool, &definition_key(&path)).await?;
        settings_repo::set_value(pool, &definition_key(&mapped), "1", now).await?;
    }
    Ok(TagMutation {
        items,
        definitions: definitions(pool).await?,
    })
}

/// 删除（含子树）：事项上的路径与定义行一起清掉。
pub async fn delete(pool: &SqlitePool, path: &str, now: i64) -> AppResult<TagMutation> {
    let path = require_tag_path(path)?;
    let items = item_tags::delete_path(pool, &path, now).await?;
    for existing in definition_paths(pool).await? {
        if is_same_or_child(&existing, &path) {
            settings_repo::delete_key(pool, &definition_key(&existing)).await?;
        }
    }
    Ok(TagMutation {
        items,
        definitions: definitions(pool).await?,
    })
}

/// 定义行上限（防御：定义是用户数据，不做无上限循环；正常量级在几十条）。
const MAX_DEFINITIONS: usize = 512;

async fn definition_paths(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let keys = settings_repo::list_keys_with_prefix(pool, TAG_DEFINITION_PREFIX).await?;
    Ok(keys
        .into_iter()
        .filter_map(|key| key.strip_prefix(TAG_DEFINITION_PREFIX).map(str::to_string))
        .filter(|path| normalize_tag_path(path).is_ok())
        .take(MAX_DEFINITIONS)
        .collect())
}

fn definition_key(path: &str) -> String {
    format!("{TAG_DEFINITION_PREFIX}{path}")
}

fn map_path(tag: &str, from: &str, to: &str) -> Option<String> {
    let candidate = if tag == from {
        to.to_string()
    } else {
        format!("{to}/{}", tag.strip_prefix(&format!("{from}/"))?)
    };
    normalize_tag_path(&candidate).ok().map(|_| candidate)
}

fn is_same_or_child(tag: &str, path: &str) -> bool {
    tag == path || tag.starts_with(&format!("{path}/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::support::{fresh_pool, new_item};

    #[tokio::test]
    async fn rename_moves_the_whole_subtree_and_the_definition_rows() {
        let pool = fresh_pool("tag-rename-subtree").await;
        let study = new_item(&pool, "考公").await;
        let play = new_item(&pool, "燕云").await;
        set(&pool, study, &["学习".into(), "学习/考公".into()], 1).await.unwrap();
        set(&pool, play, &["娱乐/燕云".into()], 1).await.unwrap();
        create_definition(&pool, "学习/考公", 1).await.unwrap();
        create_definition(&pool, "学习/笔记", 1).await.unwrap();

        let result = rename(&pool, "学习", "学业", 2).await.expect("改名应成功");
        assert_eq!(result.items, 1, "只有挂了 学习/** 的事项该被改到");
        assert!(result.definitions.contains(&"学业/考公".to_string()));
        assert!(result.definitions.contains(&"学业/笔记".to_string()));
        assert!(!result.definitions.iter().any(|path| path.starts_with("学习")));

        let rows = list(&pool).await.unwrap();
        let study_row = rows.iter().find(|row| row.item_id == study).unwrap();
        assert_eq!(study_row.tags, vec!["学业".to_string(), "学业/考公".to_string()]);
        let play_row = rows.iter().find(|row| row.item_id == play).unwrap();
        assert_eq!(play_row.tags, vec!["娱乐/燕云".to_string()], "无关子树不许被改");
    }

    #[tokio::test]
    async fn delete_drops_the_subtree_from_items_and_definitions() {
        let pool = fresh_pool("tag-delete-subtree").await;
        let id = new_item(&pool, "剪视频").await;
        set(&pool, id, &["娱乐/剪辑".into(), "娱乐".into(), "工作".into()], 1)
            .await
            .unwrap();
        create_definition(&pool, "娱乐/剪辑", 1).await.unwrap();

        let result = delete(&pool, "娱乐", 2).await.expect("删除应成功");
        assert_eq!(result.items, 1);
        /* 定义行只有「建过的」那一批：`工作` 只挂在事项上，没有定义行 */
        assert!(result.definitions.is_empty());

        let rows = list(&pool).await.unwrap();
        let row = rows.iter().find(|row| row.item_id == id).unwrap();
        assert_eq!(row.tags, vec!["工作".to_string()]);
    }

    #[tokio::test]
    async fn definitions_survive_without_any_item_referencing_them() {
        let pool = fresh_pool("tag-definitions").await;
        let stored = create_definition(&pool, "#复盘/周报 ", 1).await.expect("新建应成功");
        assert_eq!(stored, vec!["复盘/周报".to_string()]);
        /* 没有事项引用也读得回来 —— 这正是「新建了但界面里没有」要防的事 */
        assert_eq!(definitions(&pool).await.unwrap(), vec!["复盘/周报".to_string()]);
    }

    #[tokio::test]
    async fn invalid_paths_are_rejected_instead_of_silently_stored() {
        let pool = fresh_pool("tag-invalid").await;
        assert!(create_definition(&pool, "", 1).await.is_err());
        assert!(create_definition(&pool, "a/b/c/d/e", 1).await.is_err());
        assert!(create_definition(&pool, "a/#b", 1).await.is_err());
    }
}
