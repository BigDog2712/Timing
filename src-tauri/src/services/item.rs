//! 事项业务：校验（空名 / 超长）、系统事项保护、排序。
//!
//! **允许同名**（ADR-021，2026-10-18）：事项靠 `id` 区分，名字只是展示，不再做唯一性校验。
//! 名字用 `name_exists` 拦重复会连带把「归档后重建同名」「两条同名但不同色」这类正当需求挡掉，
//! 且「今日计时」已改为同名不同事项拆行，不再依赖名字唯一（见 `src/lib/todayGroups.ts`）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::constants::ITEM_NAME_MAX_LEN;
use crate::models::enums::item_status;
use crate::models::item::{Item, ItemCreate, ItemPatch};
use crate::platform::clock::now_ms;
use crate::repositories::item as repo;

pub async fn list(pool: &SqlitePool, include_archived: bool) -> AppResult<Vec<Item>> {
    repo::list(pool, include_archived).await
}

/// 名称校验：trim 后非空且 ≤ `ITEM_NAME_MAX_LEN`。
///
/// 前端两处输入框都限制 60 字（`ItemPicker` / `InlineNameEntry`），后端此前不校验，
/// 绕过 UI 直接调 IPC 可存进任意长名称（托盘会按宽度截断，展示与数据不一致）。
/// V0.3.0 补后端同值校验，超长 → `ITEM_NAME_TOO_LONG`（ADR-018）。
fn normalize_name(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::item_name_empty());
    }
    if trimmed.chars().count() > ITEM_NAME_MAX_LEN {
        return Err(AppError::text_too_long("事项名称", ITEM_NAME_MAX_LEN));
    }
    Ok(trimmed.to_string())
}

pub async fn create(pool: &SqlitePool, name: &str, color: Option<String>) -> AppResult<Item> {
    create_in(
        pool,
        &ItemCreate {
            name: name.to_string(),
            color,
            parent_id: None,
            category_key: None,
        },
    )
    .await
}

/// 事项树的**唯一**分层入口（2 层硬限）。
///
/// ## 为什么限 2 层
///
/// 允许无限深会立刻产生三个无解歧义：块挂在树的哪一层、父事项能不能自己计时、
/// rollup 到哪一层出报表。限 2 层 + 「有子事项的事项不可计时」（见
/// `services::timer::start`）这三个问题一起消失。
///
/// ## 为什么 `depth` 由这里算而不接受前端传
///
/// 它是 `parent_id` 的派生值。让前端传就有两个真源：改父子关系时忘了同步 depth
/// 会得到「depth=0 但挂着父」的行，而所有「取顶层」的查询都按 depth 过滤 ——
/// 这些行会从界面上消失，且没有任何报错。
pub async fn create_in(pool: &SqlitePool, input: &ItemCreate) -> AppResult<Item> {
    let trimmed = normalize_name(&input.name)?;
    let depth = resolve_depth(pool, input.parent_id).await?;
    let now = now_ms();
    let sort_order = repo::max_sort_order(pool).await? + 1;
    let normalized = normalize_color(input.color.clone());
    let category = normalize_category(input.category_key.as_deref());
    let id = repo::insert(
        pool,
        repo::NewItem {
            name: &trimmed,
            color: normalized.as_deref(),
            sort_order,
            now,
            parent_id: input.parent_id,
            depth,
            category_key: category.as_deref(),
        },
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

/// 新事项该落在第几层；同时把「父必须存在且是顶层」这条规则钉在这里。
async fn resolve_depth(pool: &SqlitePool, parent_id: Option<i64>) -> AppResult<i64> {
    let Some(parent_id) = parent_id else {
        return Ok(0);
    };
    let parent = repo::find_by_id(pool, parent_id)
        .await?
        .ok_or_else(AppError::item_not_found)?;
    if parent.depth != 0 {
        // 子事项不能再挂子：拦在写入前，而不是让它长成第 3 层再回头清理。
        return Err(AppError::item_depth_exceeded());
    }
    Ok(1)
}

pub async fn update(pool: &SqlitePool, id: i64, patch: ItemPatch) -> AppResult<Item> {
    fetch_or_not_found(pool, id).await?;

    let mut name_to_set: Option<String> = None;
    if let Some(raw) = patch.name.as_ref() {
        name_to_set = Some(normalize_name(raw)?);
    }

    // color：仅当提供非空值时更新（Some("") 视为不修改，MVP 不支持清空）
    let color_to_set = patch
        .color
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string);

    /* 改父子关系要连带改 depth，而 depth 一变，它已有的子就会变成第 3 层。
       所以在**允许挂到别人下面之前**先确认它自己没有子。 */
    let mut depth_to_set: Option<i64> = None;
    if let Some(parent) = patch.parent_id {
        if parent == Some(id) {
            return Err(AppError::item_depth_exceeded());
        }
        if parent.is_none() {
            depth_to_set = Some(0);
        } else {
            if repo::count_children(pool, id).await? > 0 {
                return Err(AppError::item_depth_exceeded());
            }
            depth_to_set = Some(resolve_depth(pool, parent).await?);
        }
    }

    /* 借用检查：`ItemFields` 里的分类是 `Option<Option<&str>>`（避免每列都克隆），
       所以归一后的 `String` 要先落成局部变量活到 `repo::update` 调用结束。 */
    let category_to_set: Option<Option<String>> = patch
        .category_key
        .as_ref()
        .map(|value| normalize_category(value.as_deref()));

    repo::update(
        pool,
        id,
        repo::ItemFields {
            name: name_to_set.as_deref(),
            color: color_to_set.as_deref(),
            sort_order: patch.sort_order,
            remind_at: patch.remind_at,
            is_pinned: patch.is_pinned,
            parent_id: patch.parent_id,
            /* 只有「父子关系真的改了」才写 depth：没改就传 None，别把 existing 再写一遍
               （那会多一次 `updated_at_ms` 盖戳，同步端看到一条没变化的变更）。 */
            depth: depth_to_set,
            category_key: category_to_set.as_ref().map(|value| value.as_deref()),
        },
        now_ms(),
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

pub async fn archive(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    let existing = fetch_or_not_found(pool, id).await?;
    if existing.is_system {
        return Err(AppError::item_system_protected());
    }
    repo::set_status(pool, id, item_status::ARCHIVED, now_ms()).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn unarchive(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    fetch_or_not_found(pool, id).await?;
    repo::set_status(pool, id, item_status::ACTIVE, now_ms()).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    let existing = fetch_or_not_found(pool, id).await?;
    if existing.is_system {
        return Err(AppError::item_system_protected());
    }
    /* [0.14] 级联软删（同一事务）：查直接子 → 逐个软删 → 删父。树硬限 2 层，
       直接子就是全部子孙（无孙层）；archived 子也级联（归档是软态，不跳过）。
       事务不可省：删到一半断掉的话，父还在、子已删一半，「父块含子块」的
       读路径会看到半棵树，且没有任何报错。 */
    let mut tx = pool.begin().await?;
    let children = repo::list_children(&mut *tx, id).await?;
    let now = now_ms();
    for child in &children {
        repo::soft_delete(&mut *tx, child.id, now).await?;
    }
    repo::soft_delete(&mut *tx, id, now).await?;
    tx.commit().await?;
    Ok(())
}

async fn fetch_or_not_found(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::item_not_found)
}

fn normalize_color(color: Option<String>) -> Option<String> {
    color
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

/// 分类键归一：留 trim 后的非空值，其余一律 `None`。
///
/// 不校验「分类是否存在」：分类集属于活动库（`classification_settings`），
/// 业务库这一层够不着；而写进来的键即使当前不存在，也只是「暂时解析到兜底」，
/// 用户之后建同名分类就会自动生效 —— 比直接拒绝写入更不挡人。
fn normalize_category(category: Option<&str>) -> Option<String> {
    category
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
