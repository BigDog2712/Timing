//! 「测试连接」：在**未保存**的配置上先验一遍，回答「这么填能用吗」（设计 §3.5）。
//!
//! 从 `mod.rs` 拆出来是为了让那边只剩「判据 + 分派」（它贴着 150 行预算）：这里只做
//! 一次探测，不写任何状态——不建 `{date}.md`、不落 `pending`、不改配置。
//!
//! 两个模式的判据不同：本地目录问「能不能写」，WebDAV 问「鉴权与目录通不通」
//! （`probe` 把 200 与 404 都算通：404 只说明今天那份还没建）。
//!
//! [V0.11.14] 修 O8：`probe` 现在给三档结论，405 / 3xx 这一档是「通，但服务端不支持
//! 直接读目录」。它必须判成**通过**并说清原因——很多服务端对「GET 一个目录」本来就
//! 回 405，用户却按旧文案以为地址或密码填错了。

use sqlx::SqlitePool;

use super::round_push;
use crate::error::AppResult;
use crate::infra::md_webdav;
use crate::infra::secret as secret_store;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MdSyncTestResult};
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

fn verdict(ok: bool, detail: impl Into<String>) -> MdSyncTestResult {
    MdSyncTestResult {
        ok,
        detail: detail.into(),
    }
}

/// `LocalFolder`：判「这个目录能不能写」。探针文件名带点前缀，写完立刻删掉——
/// 测连接不该在用户的同步目录里留下一份内容可疑的文件。
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

/// `Webdav`：`probe` 一次远端目录，按三档结论给话（[V0.11.14] 修 O8）。
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
    match md_webdav::probe(&target, "").await {
        Ok(md_webdav::ProbeOutcome::Reachable) => verdict(
            true,
            format!("连接正常：{}", md_webdav::redact(&cloud.base_url)),
        ),
        /* 地址与账号已经通了，只是服务端不肯对目录发 GET。同步 GET 的是 `{date}.md`
        这个具体文件，所以这条通道照样能用——文案要让用户看得出「你没填错」，
        否则他会去反复改一个本来就对的地址。 */
        Ok(md_webdav::ProbeOutcome::NoDirectoryListing(code)) => verdict(
            true,
            format!(
                "地址与账号能通，但服务端不支持直接读目录（{code}）；\
                 同步单个文件不受影响，可以保存"
            ),
        ),
        Err(err) => verdict(false, round_push::fail_text(&err)),
    }
}
