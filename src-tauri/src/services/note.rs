//! 便利贴业务：正文长度校验、几何硬钳制、软删除、窗口打开护栏（ADR-009）。
//!
//! 契约：`ARCHITECTURE-V0.2.0 §5 便利贴 note(5)`。缺失 → `NOTE_NOT_FOUND`；
//! 超上限 → `WINDOW_LIMIT_EXCEEDED`；几何硬钳制 [160,120]~[900,900]。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::clock::now_ms;
use crate::models::constants::{
    MAX_NOTE_WINDOWS, NOTE_CONTENT_MAX_LEN, NOTE_MAX_H, NOTE_MAX_W, NOTE_MIN_H, NOTE_MIN_W,
};
use crate::models::note::{Note, NoteCreateParams, NoteGeometry, NoteGeometryPatch, NotePatch};
use crate::repositories::item as item_repo;
use crate::repositories::note as repo;

pub async fn create(pool: &SqlitePool, params: NoteCreateParams) -> AppResult<Note> {
    let content = check_content(&params.content)?;
    if let Some(item_id) = params.item_id {
        ensure_item(pool, item_id).await?;
    }
    let (width, height) = clamp_size(params.width, params.height);
    let now = now_ms();
    let id = repo::insert(
        pool,
        params.item_id,
        &content,
        NoteGeometry {
            pos_x: params.pos_x,
            pos_y: params.pos_y,
            width,
            height,
        },
        now,
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

pub async fn get(pool: &SqlitePool, id: i64) -> AppResult<Note> {
    fetch_or_not_found(pool, id).await
}

pub async fn list(pool: &SqlitePool, item_id: Option<i64>) -> AppResult<Vec<Note>> {
    repo::list(pool, item_id).await
}

/// 启动恢复：`is_open=1 AND deleted_at IS NULL` 的便利贴（ADR-009 §5）。
pub async fn list_open(pool: &SqlitePool) -> AppResult<Vec<Note>> {
    repo::list_open(pool).await
}

pub async fn update(pool: &SqlitePool, id: i64, patch: NotePatch) -> AppResult<Note> {
    fetch_or_not_found(pool, id).await?;
    let content = match patch.content {
        Some(ref raw) => Some(check_content(raw)?),
        None => None,
    };
    if let Some(Some(item_id)) = patch.item_id {
        ensure_item(pool, item_id).await?;
    }
    let (width, height) = clamp_partial(patch.width, patch.height);
    repo::update(
        pool,
        id,
        content.as_deref(),
        patch.item_id,
        NoteGeometryPatch {
            pos_x: patch.pos_x,
            pos_y: patch.pos_y,
            width,
            height,
        },
        now_ms(),
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

/// 软删除。存在则返回被删除的便利贴（供调用方关闭窗口 / emit 事件）；不存在返回 `None`。
pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<Option<Note>> {
    let Some(note) = repo::find_by_id(pool, id).await? else {
        return Ok(None);
    };
    repo::soft_delete(pool, id, now_ms()).await?;
    Ok(Some(note))
}

/// 打开窗口护栏：校验存在 + 计数上限（超限 `WINDOW_LIMIT_EXCEEDED`）+ 置 `is_open=1`。
pub async fn open_guard(pool: &SqlitePool, id: i64) -> AppResult<Note> {
    let note = fetch_or_not_found(pool, id).await?;
    if !note.is_open {
        let open = repo::count_open(pool).await? as usize;
        if open >= MAX_NOTE_WINDOWS {
            return Err(AppError::window_limit_exceeded(MAX_NOTE_WINDOWS));
        }
        repo::set_open(pool, id, true, now_ms()).await?;
    }
    fetch_or_not_found(pool, id).await
}

/// 收纳：落盘几何（若提供）+ 置 `is_open=0`；返回更新后的便利贴。
pub async fn close(pool: &SqlitePool, id: i64, geom: Option<NoteGeometry>) -> AppResult<Note> {
    fetch_or_not_found(pool, id).await?;
    let geometry = match geom {
        Some(g) => NoteGeometryPatch {
            pos_x: Some(g.pos_x),
            pos_y: Some(g.pos_y),
            width: Some(g.width),
            height: Some(g.height),
        },
        None => NoteGeometryPatch::default(),
    };
    repo::update(pool, id, None, None, geometry, now_ms()).await?;
    repo::set_open(pool, id, false, now_ms()).await?;
    fetch_or_not_found(pool, id).await
}

/// 便利贴正文长度校验（长度上限见 `NOTE_CONTENT_MAX_LEN`；允许为空）。
///
/// 超长无专用错误码（错误码集锁定 16 个），复用 `ITEM_NAME_EMPTY` 并给明确 message
/// （与待办超长标题同法，绝不静默截断）。
fn check_content(raw: &str) -> AppResult<String> {
    if raw.chars().count() > NOTE_CONTENT_MAX_LEN {
        return Err(AppError::new(
            ErrorCode::ItemNameEmpty,
            format!("便利贴正文长度不能超过 {NOTE_CONTENT_MAX_LEN} 字"),
        ));
    }
    Ok(raw.to_string())
}

/// 硬钳制尺寸到 [160,120]~[900,900]。
fn clamp_size(width: f64, height: f64) -> (f64, f64) {
    (
        width.clamp(NOTE_MIN_W, NOTE_MAX_W),
        height.clamp(NOTE_MIN_H, NOTE_MAX_H),
    )
}

/// 部分更新时的尺寸钳制（仅对提供了的维度生效）。
fn clamp_partial(width: Option<f64>, height: Option<f64>) -> (Option<f64>, Option<f64>) {
    (
        width.map(|w| w.clamp(NOTE_MIN_W, NOTE_MAX_W)),
        height.map(|h| h.clamp(NOTE_MIN_H, NOTE_MAX_H)),
    )
}

async fn ensure_item(pool: &SqlitePool, item_id: i64) -> AppResult<()> {
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    Ok(())
}

async fn fetch_or_not_found(pool: &SqlitePool, id: i64) -> AppResult<Note> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::note_not_found)
}
