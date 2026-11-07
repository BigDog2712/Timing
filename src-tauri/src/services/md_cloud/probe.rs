//! 「测试连接」：在**未保存**的配置上先验一遍，回答「这么填能用吗」（设计 §3.5 / §4.4）。
//!
//! 从 `md_cloud/mod.rs` 拆出来是为了让那边只剩「判据 + 分派」：这里只做一次探测，
//! 不写任何状态——不建 `{date}.md`、不落 `pending`、不改配置。
//!
//! ## 三关（[V0.11.16]，PRD R8/R9）
//!
//! ```text
//! 第 1 关 账号   probe(target, "")            → 地址通、凭据对
//! 第 2 关 目录   dir::ensure_base_dir(target) → 每一级 MKCOL 就绪（失败带出「卡在第几级」）
//! 第 3 关 写入   probe_file::write_probe      → PUT 一个探针文件，随后 DELETE
//! ```
//!
//! 每关失败即 `return`，后续关**不出现**（PRD E6「红在第 1 关时第 2、3 关不显示通过」
//! 由数据结构保证，不靠前端藏）。`ok` / `detail` 的语义一个字没变：老渲染路径不退化。
//!
//! 为什么不用「一个 `if dir_exists` 去猜」：`403` 在 MKCOL 与 PUT 上成因不同，而「目录
//! 在不在」这个布尔量在 PUT 403 时**恰恰可能为真**（目录在，但只读 / 配额满）——用它
//! 分诊会把「写不进去」误报成「建不出来」，用户去网页版建一个已经存在的目录。
//!
//! ## 旧口径仍然有效
//!
//! [V0.11.14] 修 O8：`probe` 给三档结论，405 / 3xx 这一档是「通，但服务端不支持直接
//! 读目录」——必须判成**通过**并说清原因（很多服务端对「GET 一个目录」本来就回 405）。

use sqlx::SqlitePool;

use super::text::{FailStage, dir_label, fail_text_at};
use crate::error::AppResult;
use crate::infra::md_webdav;
use crate::infra::secret as secret_store;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MdSyncTestResult, MdSyncTestStep};
use crate::models::md_sync_config::MdSyncConfig;

/// 在给定配置上测一次。`secret = Some(..)` 用用户刚输入的密码，`None` 用已存的那份。
///
/// `_pool` 目前不参与判断（密文走 `infra::secret`，不读库）：签名里留着是为了与
/// `view` / `round` 同形，命令层不必为一个参数分两套写法。
pub async fn test_connection(
    _pool: &SqlitePool,
    config: &MdSyncConfig,
    secret: Option<&str>,
) -> AppResult<MdSyncTestResult> {
    let Some(cloud) = config.cloud.as_ref() else {
        return Ok(verdict(false, "还没配置云端通道"));
    };
    if let Err(err) = cloud.validate(&config.bindings) {
        return Ok(verdict(false, err));
    }
    match cloud.mode {
        CloudMode::LocalFolder => Ok(test_folder(cloud)),
        CloudMode::Webdav => Ok(test_webdav(cloud, secret).await),
    }
}

/// 还没走到第一关就结束（没配通道 / 字段不合法 / 没密码）：`steps` 为空，
/// 前端据此退回「只显示 `detail`」那条老渲染路径。
fn verdict(ok: bool, detail: impl Into<String>) -> MdSyncTestResult {
    MdSyncTestResult {
        ok,
        detail: detail.into(),
        steps: Vec::new(),
    }
}

fn step(key: &str, ok: bool, detail: Option<String>) -> MdSyncTestStep {
    MdSyncTestStep {
        key: key.to_string(),
        ok,
        detail,
    }
}

/// 停在某一关：**只把走过的关带出去**，失败那一关的 `detail` 同时充当摘要句
/// （不拼接、不改写——用户看到的就是那一关要说的话）。
fn stopped(mut steps: Vec<MdSyncTestStep>, key: &str, detail: String) -> MdSyncTestResult {
    steps.push(step(key, false, Some(detail.clone())));
    MdSyncTestResult {
        ok: false,
        detail,
        steps,
    }
}

/// `LocalFolder`：判「这个目录能不能写」。探针写完立刻删掉。
///
/// 这条路只有一个动作，所以 `steps` 是空 vec：硬造三关只会让界面多出两行假结论。
fn test_folder(cloud: &MdSyncCloud) -> MdSyncTestResult {
    let root = match cloud.resolve_root() {
        Ok(path) => path,
        Err(err) => return verdict(false, err),
    };
    if let Err(err) = std::fs::create_dir_all(&root) {
        return verdict(false, format!("建不了这个目录：{err}"));
    }
    let probe = root.join(".timing-write-test");
    match std::fs::write(&probe, b"timing") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            verdict(true, format!("目录可写：{}", root.display()))
        }
        Err(err) => verdict(false, format!("这个目录写不进去：{err}")),
    }
}

/// `Webdav`：三关都过才绿字。
///
/// 绿字的判据是「**真的写过一份文件**」：只验地址与凭据（v0.11.14 之前）会让
/// 「测试连接绿字、同步一路 409/403」反复出现。
async fn test_webdav(cloud: &MdSyncCloud, secret: Option<&str>) -> MdSyncTestResult {
    let password = match secret {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        Some(_) => return verdict(false, "应用密码是空的"),
        None => match secret_store::get(secret_store::KEY_WEBDAV).await {
            Ok(Some(value)) if !value.trim().is_empty() => value,
            Ok(_) => return verdict(false, "还没保存应用密码"),
            Err(err) => return verdict(false, err),
        },
    };
    let dir = match cloud.remote_dir() {
        Ok(dir) => dir,
        Err(err) => return verdict(false, err),
    };
    let target = md_webdav::WebdavTarget::new(&cloud.base_url, &dir, &cloud.user, &password);

    /* 第 1 关：地址与凭据。`NoDirectoryListing` 也是通过——同步 GET 的是 `{date}.md`
    这个具体文件，服务端不肯对目录发 GET 不影响这条通道。 */
    let listing = match md_webdav::probe(&target, "").await {
        Ok(md_webdav::ProbeOutcome::Reachable) => None,
        Ok(md_webdav::ProbeOutcome::NoDirectoryListing(code)) => Some(code),
        Err(err) => {
            let text = fail_text_at(FailStage::Account, &err, &target.base_path);
            return stopped(vec![], "account", text);
        }
    };
    let mut steps = vec![step("account", true, None)];

    /* 第 2 关：目录就绪。失败时 `DirFailure` 带出「卡在第几级」，文案据此分诊。 */
    let created = match md_webdav::dir::ensure_base_dir(&target).await {
        Ok(md_webdav::dir::EnsureOutcome::Ready { created, .. }) => created,
        Ok(md_webdav::dir::EnsureOutcome::TooDeep { levels }) => {
            let text = format!(
                "远端目录{}有 {levels} 级，程序最多自动建 {} 级；\
                 请到网盘网页版手动建好，或把目录改浅一点",
                dir_label(&target.base_path),
                md_webdav::dir::MAX_LEVELS
            );
            return stopped(steps, "dir", text);
        }
        Err(failure) => {
            let text = fail_text_at(
                FailStage::Dir {
                    level: &failure.level,
                    ready: failure.ready,
                },
                &failure.error,
                &target.base_path,
            );
            return stopped(steps, "dir", text);
        }
    };
    steps.push(step("dir", true, None));

    /* 第 3 关：真写一次再删掉。这是唯一能把「目录建得出来但写不进去」从 403 里分离
    出来的手段（PRD Q3 的裁决理由）。 */
    if let Err(err) = md_webdav::probe_file::write_probe(&target).await {
        let text = fail_text_at(FailStage::Write, &err, &target.base_path);
        return stopped(steps, "write", text);
    }
    steps.push(step("write", true, None));

    let mut detail = String::from("账号、目录、写入都通过");
    if created > 0 {
        detail.push_str(&format!("（新建 {created} 级目录）"));
    }
    if let Some(code) = listing {
        /* 状态码只进日志（全项目同一条纪律）：绿字里带 `405` 对用户零信息量，
           而排障时「服务端到底回了什么」恰恰是第一条要看的线索。 */
        crate::log_info!("md cloud test: dir listing unsupported code={code}");
        detail.push_str("（服务端不支持直接读目录，已按正常处理）");
    }
    MdSyncTestResult {
        ok: true,
        detail,
        steps,
    }
}
