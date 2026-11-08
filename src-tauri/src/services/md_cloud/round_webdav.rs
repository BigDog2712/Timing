//! WebDAV 那一轮（V0.11.13，设计 §2.3 / §4.1）。桌面与手机共用同一份。
//!
//! ## 顺序不可换（这是本轮最大的难点，改之前先读设计 §2.3）
//!
//! ```text
//! ① 应用密码 → ② 登记落点 + 建目录 → ④ GET 今天 → ⑤ md_sync::run（Obsidian）
//! ⑥ mirror::run_in（云端落点）→ ⑦ 算指纹记欠账 → ⑧ PUT 今天 → ⑨ 补传历史
//! ```
//!
//! ⑤ 必须在 ⑥ 之前：Obsidian 那份的用户手改先入库，云端这份再从「已含手改的 SQL」
//! 渲染出去，于是 **PUT 上去的内容一定含本轮全部变更**。反过来（云端轮在前）会让
//! PUT 的内容缺 Obsidian 的手改，要等下一轮才补上。
//!
//! ④ GET 必须在两轮之前：远端那份是当天合并的另一半输入，晚读就等于用旧内容做判定。
//!
//! ⑤ 是**桌面专属**（`#[cfg(not(mobile))]`）：手机没有「桌面 root」，出厂模板
//! `%APP_DIR%\md` 在 Android 上解析进应用沙箱，那一轮只会往用户够不着的目录里渲染。
//! 手机本地那一轮由 `sync_once` 的 SAF 三步负责，⑥ 在手机上是唯一的一轮。
//!
//! ## 谁失败要不要「整轮结束」
//!
//! - 密码缺失 / 凭据解不开 → **不 PUT、不发任何请求**，直接返回（带着空密码去连只会
//!   换回一次 401，用户看到的就成了「密码不对」）；
//! - Auth / Forbidden / RateLimited → 记 error 后整轮结束（继续本地两步只会让报告看起来
//!   像成功，而用户真正要知道的是「传不上去」）；
//! - Timeout / Network / Server / Precondition → 记 error 但**继续**跑本地两步：离线时
//!   用户还在 Obsidian 里记，落点该对齐就对齐，下一次联网才补得上去。
//!
//! ## 空文件不 PUT
//!
//! GET 失败（超时）且本地也没有那天的文件时，`text` 是空串。这时候无条件 PUT 会把
//! 远端已有内容覆盖成空——那是真的丢数据。空内容一律跳过（`skip=empty`）。

use std::fs;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use super::{absorb, backoff, pending, round_push};
use crate::error::AppResult;
use crate::infra::md_webdav::{self, WebdavError, WebdavTarget};
use crate::infra::{md_backup, secret};
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::platform::clock::now_ms;
use crate::services::md_sync::mirror;
/* ⑤ 只在桌面存在（见 `run` 里那句 cfg 的说明），手机上这个 import 会变成死码。 */
#[cfg(not(mobile))]
use crate::services::md_sync;

/// 一轮：远端 → 两个本地落点 → 远端。
///
/// [V0.11.26] 参数从 `&MdSyncCloud` 改为 `&MdSyncCloudChannel`（webdav 通路自己的
/// 那份配置），记账固定带 `PurgeChannel::Webdav`。
pub async fn run(
    pool: &SqlitePool,
    channel: &MdSyncCloudChannel,
    today: &str,
) -> AppResult<MdSyncReport> {
    let now = now_ms();
    let mut report = MdSyncReport::new(now);

    /* ① 应用密码。三种「拿不到」分开说：排障方向完全不同。 */
    let password = match secret::get(secret::KEY_WEBDAV).await {
        Ok(Some(value)) if !value.trim().is_empty() => value,
        Ok(Some(_)) => {
            report.errors.push("应用密码是空的：请到设置页重新填写".into());
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

    /* ② 落点根 + 备份标识 + 目录。 */
    let cloud_root = match prepare(channel, &mut report) {
        Some(root) => root,
        None => return Ok(report),
    };
    let dir = match channel.remote_dir() {
        Ok(dir) => dir,
        Err(err) => {
            report.errors.push(err);
            return Ok(report);
        }
    };
    let target = WebdavTarget::new(&channel.base_url, &dir, &channel.user, &password);
    let rel = format!("{today}.md");
    let local_path = cloud_root.join(&rel);

    /* 退避放在取密码之后：退避是「别把限流烧掉」，而「没密码」这一轮根本不出网，
    不该被上一轮的失败拖住。 */
    if backoff::should_skip(now).await {
        crate::log_info!("md cloud: today={today} skip=backoff");
        report
            .errors
            .push("云端：上一轮失败，正在退避（稍后自动重试）".into());
        return Ok(report);
    }

    /* ④ GET 今天。`got_remote` 决定后面「本地为空」能不能当成事实（见模块注释）。 */
    let mut etag: Option<String> = None;
    let got_remote = match md_webdav::get(&target, &rel).await {
        Ok(outcome) => {
            etag = outcome.etag.clone();
            land(&local_path, &outcome.bytes, &mut report);
            crate::log_info!(
                "md cloud in: {today}.md bytes={} etag={}",
                outcome.bytes.len(),
                round_push::etag_tag(&etag)
            );
            true
        }
        Err(WebdavError::NotFound) => {
            /* 今天还没记（或远端还没有这天）：正常结果，不是错误。 */
            crate::log_info!("md cloud in: {today}.md bytes=0 etag=none status=404");
            false
        }
        Err(err) if round_push::fatal(&err) => {
            backoff::on_failure(now).await;
            crate::log_warn!("md cloud in: {today}.md fail={}", round_push::fail_tag(&err));
            report.errors.push(round_push::fail_text(&err, &target.base_path));
            return Ok(report);
        }
        Err(err) => {
            backoff::on_failure(now).await;
            crate::log_warn!("md cloud in: {today}.md fail={}", round_push::fail_tag(&err));
            report.errors.push(round_push::fail_text(&err, &target.base_path));
            false
        }
    };

    /* ⑤ Obsidian 落点（既有逻辑一行不改），⑥ 云端落点（`sync_all` 的包装）。
    手机上跳过 ⑤：手机没有「桌面 root」这个概念，`binding.root` 的出厂模板
    `%APP_DIR%\md` 在 Android 上会解析进应用沙箱（`\` 不是分隔符，那一段甚至可能
    变形成一个含反斜杠的目录名），跑这一轮只会把区块渲染进用户够不着的目录，
    同时让设置页把该落点显示成「路径正常、已存在」。手机本地那一轮由 `sync_once`
    的 SAF 三步负责（`app/md_sync_mobile.rs`），云端模式下它本就不该存在。
    ⑥ 无条件保留：手机上它是唯一的一轮，云端那份内容全靠它。 */
    #[cfg(not(mobile))]
    {
        let local = md_sync::run(pool).await?;
        absorb(&mut report, local);
    }
    let cloud_report = mirror::run_in(pool, &cloud_root.to_string_lossy()).await?;
    absorb(&mut report, cloud_report);

    /* ⑦ 指纹。读的是**合并之后**的文件：内容没变就没有欠账，不需要知道方向。 */
    let text = fs::read_to_string(&local_path).unwrap_or_default();
    if pending::record_if_changed(pool, PurgeChannel::Webdav, today, &text, now).await? {
        crate::log_info!("md cloud: today={today} 本地内容有变化");
    }

    /* ⑧ PUT 今天。空内容且没读到远端 → 本地这一轮什么都没合出来，PUT 会把远端清空。 */
    let skip_empty = text.trim().is_empty() && !got_remote;
    /* `#[cfg(not(mobile))]`：手机上不装 ⑩，这个基准值也就没有第二个读者 —— 不给
       Android 留一条「定义了没人用」的告警。 */
    #[cfg(not(mobile))]
    let errors_before_push = report.errors.len();
    if skip_empty {
        crate::log_info!("md cloud out: {today}.md skip=empty");
    } else {
        round_push::push_today(
            pool,
            &target,
            today,
            &text,
            etag.as_deref(),
            &cloud_root,
            &mut report,
        )
        .await?;
    }
    /* ⑩ 的前置条件①：**本轮 ⑧ 真的 PUT 成功过**。
       `skip=empty` 算未成功：一个请求都没发，此时去删就是拿未知的连通性赌破坏性操作。
       用「调用前后的 errors.len() 之差」判，不去解析错误文案（文案会改，长度不会）。
       必须在 ⑨ **之前**取值：⑨ 的失败不该影响「今天这份传上去了」这个事实。 */
    #[cfg(not(mobile))]
    let push_ok = !skip_empty && report.errors.len() == errors_before_push;

    /* ⑨ 历史欠账。 */
    round_push::push_history(pool, &target, &cloud_root, today, &mut report).await?;

    /* ⑩ 往期真删（变更 A 的唯一挂点，在 ⑨ 之后）。清理失败**不进** `report.errors`：
       I11 要求失败的 DELETE 不许把「今天上传成功」这条主链路染红（见 `purge/mod.rs` 头）。 */
    #[cfg(not(mobile))]
    if push_ok {
        /* 只可能失败在记账层（sqlite），DELETE 本身的失败一律记账、不返回 Err。
           这里吞掉并留一条 WARN：⑧ 已经把今天传上去了，这一轮的 report 该原样交出去，
           清理是后台维护动作，不许把主链路折成 Err（PRD I11）。 */
        if let Err(err) = super::purge::run_webdav(pool, &target, &cloud_root, today).await {
            crate::log_warn!("md cloud purge: 记账失败（不影响本轮同步）{err:?}");
        }
    }

    /* 每轮必打：这是「今天传了但历史有欠账」的唯一可见出口。 */
    let pending_dates = pending::dates(pool, PurgeChannel::Webdav).await.unwrap_or_default();
    crate::log_info!(
        "md cloud: pending=[{}] today={today}",
        pending_dates.join(",")
    );
    Ok(report)
}

/// 登记备份标识 + 建目录。返回解析后的落点根；`None` = 原因已写进 `report.errors`。
fn prepare(channel: &MdSyncCloudChannel, report: &mut MdSyncReport) -> Option<PathBuf> {
    let root = match channel.resolve_root_webdav() {
        Ok(path) => path,
        Err(err) => {
            report.errors.push(err);
            return None;
        }
    };
    /* 注册必须在云端那轮**之前**：`write_section` 靠注册表决定备份文件名前缀，
    登记晚了本轮的备份就会标成 `obsidian`。 */
    md_backup::register_root(root.clone(), "webdav");
    /* 落点每轮记一行：手机上这是**唯一**能回答「今天的日记到底写到哪了」的现场
    （沙箱目录用户看不见）。 */
    crate::log_info!("md cloud: root={}", root.display());
    if let Err(err) = fs::create_dir_all(&root) {
        report.errors.push(super::root_dir_error(&root, &err));
        return None;
    }
    Some(root)
}

/// 把远端内容落到本地文件（写前留底，与 `write_section` 同一口径：
/// 远端那份会成为本地的「上一版」，边界判错时还有一份原件）。
fn land(path: &Path, bytes: &[u8], report: &mut MdSyncReport) {
    if let Ok(existing) = fs::read_to_string(path) {
        md_backup::save(path, &existing);
    }
    if let Err(err) = fs::write(path, bytes) {
        report.errors.push(format!("写不进云端落点文件：{err}"));
    }
}
