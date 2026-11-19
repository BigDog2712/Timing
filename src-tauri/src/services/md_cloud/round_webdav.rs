//! WebDAV 那一轮（V0.11.13；0.14.x 改为**事件流落档**）。桌面与手机共用同一份。
//!
//! ## 落档格式：不可变事件分段，不再是 `{date}.md`
//!
//! 远端现在是 `<落点>/sync/streams/<设备id>/<目标指纹>/<seq>.jsonl`（见 [`super::round_stream`] 与
//! `services::sync_stream`）。这一版**停写 md 快照**，三条理由缺一条都不该停：
//!
//! 1. **md 是「当天全量状态」的投影**：两台设备同时改一天，谁后 PUT 谁覆盖，中间那次
//!    没人知道；事件流是「谁做了什么」的追加日志，冲突可折叠、可复算。
//! 2. **md 的冲突走人工**（覆盖提醒 / 决策审计）。事件流没有这个问题 —— 折叠是确定性的，
//!    同一批事件在任何一台机器上折叠出同一份 `time_records`。
//! 3. **md 的「写了一半」无法自证**：`有效 JSONL 前缀` 与 `完整分段` 在字节层面同形，
//!    所以事件流带了完整性尾标；md 没有这个位置，只能靠 ETag / 指纹做事后怀疑。
//!
//! **停写 md 不等于删掉 md**：远端已有的 `{date}.md` 原样留着，不会自动删除（清理是用户
//! 手动的动作）。本地 Obsidian 落点照旧渲染 —— 那是用户自己的笔记目录，是 md 同步这个
//! 功能的正当用途，只是它不再充当跨设备传输的载体。
//!
//! ## 顺序
//!
//! ```text
//! ① 应用密码 → ② 远端目录 → ③ 退避 → ④ 事件流（push → pull）→ ⑤ Obsidian 落点
//! ```
//!
//! ⑤ 在 ④ 之后：这一轮从对端拉回来的事件会改写 `time_records`，Obsidian 那份要渲染的是
//! **合并之后**的状态；反过来会让本地笔记落后一轮。
//!
//! ## 谁失败要不要「整轮结束」
//!
//! - 密码缺失 / 凭据解不开 → **不发任何请求**，直接返回（带着空密码去连只会换回一次
//!   401，用户看到的就成了「密码不对」）；
//! - 退避窗口内 → 同样不发请求，只记一句；
//! - 事件流的传输失败 → 记 `report.errors` 但**不折 `AppError`**（架构 §7）：托盘还要拿
//!   本轮的计数，手机端也不该把「pull 失败但 push 成功」当成整体失败。
//!
//! 这一版不再是「本地两步 + 远端两步」的形状：md 的两个落点（本地镜像 / 远端）都没了，
//! 一轮只有事件流这一件事，外加一轮本地的 Obsidian 渲染。

use sqlx::SqlitePool;

use super::{backoff, round_stream};
/* absorb 只被 ⑤ Obsidian 那段用（`#[cfg(not(mobile))]`），移动端目标不导入。 */
#[cfg(not(mobile))]
use super::absorb;
use crate::error::AppResult;
use crate::infra::md_webdav::WebdavTarget;
use crate::infra::secret;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::platform::clock::now_ms;
use crate::services::md_sync::decision::ConflictMode;
use crate::services::sync_stream::transport::Transport;
/* ⑤ 只在桌面存在（手机没有「桌面 root」，见下面那段 cfg 的说明）。 */
#[cfg(not(mobile))]
use crate::services::md_sync;

/// 一轮：本机新增事件 → 远端 → 对端分段 → 折叠，然后渲染本地 Obsidian 落点。
pub async fn run(
    pool: &SqlitePool,
    channel: &MdSyncCloudChannel,
    #[cfg_attr(mobile, allow(unused_variables))] mode: ConflictMode,
) -> AppResult<MdSyncReport> {
    let now = now_ms();
    let mut report = MdSyncReport::new(now);

    /* ① 应用密码。三种「拿不到」分开说：排障方向完全不同。 */
    let password = match secret::get(secret::KEY_WEBDAV).await {
        Ok(Some(value)) if !value.trim().is_empty() => value,
        Ok(Some(_)) => {
            report
                .errors
                .push("应用密码是空的：请到设置页重新填写".into());
            return Ok(report);
        }
        Ok(None) => {
            report
                .errors
                .push("未设置应用密码：请到设置页填写坚果云的应用密码".into());
            return Ok(report);
        }
        /* 存过但读不出来（密文损坏 / 换了 Windows 账户 / 桥没装）。 */
        Err(err) => {
            report.errors.push(format!("系统凭据不可用：{err}"));
            return Ok(report);
        }
    };

    /* ② 远端目录。分段路径 `sync/streams/<设备>/<目标指纹>/<seq>.jsonl` 拼在它下面。 */
    let dir = match channel.remote_dir() {
        Ok(dir) => dir,
        Err(err) => {
            report.errors.push(err);
            return Ok(report);
        }
    };
    let target = WebdavTarget::new(&channel.base_url, &dir, &channel.user, &password);

    /* 退避放在取密码之后：退避是「别把限流烧掉」，而「没密码」这一轮根本不出网，
    不该被上一轮的失败拖住。 */
    if backoff::should_skip(now).await {
        crate::log_info!("md cloud: skip=backoff");
        report
            .errors
            .push("云端：上一轮失败，正在退避（稍后自动重试）".into());
        return Ok(report);
    }

    /* ④ 事件流：先 push 本机新增事件、再 pull 对端分段（一段一事务，见 `sync_stream`）。 */
    let transport = Transport::Webdav(target);
    if round_stream::run(pool, &transport, &mut report).await {
        backoff::on_success().await;
    } else {
        backoff::on_failure(now).await;
    }

    /* ⑤ Obsidian 落点（用户自己的笔记目录，**不是传输落点**）。
    手机上跳过：手机没有「桌面 root」这个概念，`binding.root` 的出厂模板
    `%APP_DIR%\md` 在 Android 上会解析进应用沙箱（`\` 不是分隔符，那一段甚至可能
    变形成一个含反斜杠的目录名），跑这一轮只会把区块渲染进用户够不着的目录，
    同时让设置页把该落点显示成「路径正常、已存在」。 */
    #[cfg(not(mobile))]
    {
        let local = md_sync::run_with(pool, mode).await?;
        absorb(&mut report, local);
    }
    Ok(report)
}
