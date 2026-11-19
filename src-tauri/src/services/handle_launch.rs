//! 「启动应用」类手柄动作的授权名单（[R1]）。
//!
//! ## 为什么需要这份名单
//!
//! `run_handle_custom_action` 的 `Launch` 分支会 `spawn` 一个路径，而载荷来自 IPC。
//! IPC 不是可信输入：渲染出来的 markdown、窗口标题、ingest 进来的网页标题都是攻击者
//! 可控的字面量，前端那份校验（`dispatch.ts`）只是**提示**，绕过它只需要一次直接调用。
//! 所以要有一份「**只有用户亲自在原生对话框里点过才会增加**」的名单，执行时只认名单。
//!
//! ## 名单为什么可以落库
//!
//! 关键不在「存在哪」，而在「**谁能写**」：`SettingsPatch` 里没有这个字段，也没有任何
//! 通用 `set_setting(key, value)` 命令，所以唯一写入路径就是
//! `pick_custom_launch_target`（弹窗 → 用户确认 → 写）。攻击者能读库不代表能加条目 ——
//! 加条目必须经过一次人机交互，这一条是它的全部安全性来源。
//!
//! ## 为什么存规范化路径
//!
//! 同一个程序有无数种写法（大小写、`8.3` 短名、`..`、符号链接、环境变量）。不规范化
//! 就会出现「名单里是 `C:\Apps\x.exe`，载荷写 `C:\apps\X.EXE` 就不认」——用户看到的
//! 是「明明选过却说未授权」，那不是安全，那是 bug。`canonicalize` 同时把符号链接解到
//! 真身，于是「白名单里放一个 lnk、事后把它指向别处」也不成立。

use sqlx::SqlitePool;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::platform::clock::now_ms;
use crate::repositories::settings as repo;

/// 名单在 settings KV 里的键。带 `handle.` 前缀而不是塞进 `Settings` 结构体：
/// 它是一条**权限事实**，不是用户偏好，不该出现在 `get_settings` 的返回里被前端随手改。
const KEY: &str = "handle.launchTargets";

/// 名单上限。不设上限 = 一个可写键无限增长；8 个手柄 × 4 个槽 = 32 已远超实际用法。
const MAX_TARGETS: usize = 64;

/// 把用户给的路径规范化成名单里认的那个字符串。
///
/// 三道检查都在 `canonicalize` **之后**：先解掉符号链接与 `..`，再看它到底是什么。
/// 反过来的话，一个指向目录的链接会先通过 `is_file` 再被解析成目录。
pub fn canonical_target(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::custom_action_denied("没有选择要启动的程序"));
    }
    let path = Path::new(trimmed);
    /* 必须是绝对路径：相对路径按**当前工作目录**解析，而那个目录在便携版里可能跟着
    用户走 —— 同一个绑定在不同次启动会指向不同文件。 */
    if !path.is_absolute() {
        return Err(AppError::custom_action_denied("只接受绝对路径"));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| AppError::custom_action_denied("这个路径不存在或无法访问"))?;
    if !canonical.is_file() {
        return Err(AppError::custom_action_denied(
            "只能启动文件，不能启动文件夹",
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

/// 读取名单。解码失败当空名单 —— 一个坏键不该让整个「启动应用」功能永久失效。
async fn load(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let raw = repo::get_value(pool, KEY).await?;
    Ok(raw
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default())
}

/// 这个路径是否**已经被用户确认过**。
pub async fn is_authorized(pool: &SqlitePool, raw: &str) -> AppResult<bool> {
    let wanted = canonical_target(raw)?;
    Ok(load(pool).await?.iter().any(|known| known == &wanted))
}

/// 用户刚在原生对话框里确认了一个路径：规范化后写进名单，返回规范化结果。
///
/// 幂等（重复授权同一个路径不会长第二条），超出上限时丢掉最早的一条 —— 手柄槽位是
/// 有限集合，早就不再被引用的条目留着只是让名单变长。
pub async fn authorize(pool: &SqlitePool, raw: &str) -> AppResult<String> {
    let target = canonical_target(raw)?;
    let mut list = load(pool).await?;
    if let Some(index) = list.iter().position(|known| known == &target) {
        /* 已在名单里：移到末尾（最常用 = 最晚被淘汰） */
        list.remove(index);
    }
    list.push(target.clone());
    if list.len() > MAX_TARGETS {
        list.drain(..list.len() - MAX_TARGETS);
    }
    let encoded = serde_json::to_string(&list).map_err(AppError::db)?;
    repo::set_value(pool, KEY, &encoded, now_ms()).await?;
    Ok(target)
}
