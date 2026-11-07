//! 「测试连接」：在**未保存**的配置上先验一遍，回答「这么填能用吗」（设计 §3.5）。
//!
//! 从 `mod.rs` 拆出来是为了让那边只剩「判据 + 分派」（它贴着 150 行预算）：这里只做
//! 一次探测，不写任何状态——不建 `{date}.md`、不落 `pending`、不改配置。
//!
//! 两个模式都问「能不能写」：本地目录写一个探针文件；WebDAV 走 `probe`（地址与凭据）
//! + `ensure_base_dir`（目录就绪）两关。
//!
//! 只有地址通、目录没建出来，同步照样一路 409——V0.11.15 修的就是这个
//! 「测试连接绿字、同步却写不上去」。
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

/// `Webdav`：**两件事**都过才绿字（V0.11.15 修 409）。
///
/// 旧版只做 `probe`（判地址 + 凭据），于是「测试连接」绿字而同步一路 409——绿字必须
/// 等于**真的能写**。现在的判据是「地址与凭据可用」+「云端目录已就绪」：
///
/// ```text
/// probe(target, "")        → Err → 红字 fail_text（早退，不建目录）
/// ensure_base_dir(target)
///   Ready{created: 0}      → 绿字「连接正常，云端目录「/Timing/md」已就绪」
///   Ready{created: n}      → 绿字「…已补建云端目录…（新建 n 级）」
///   TooDeep{levels}        → 红字「…有 {levels} 级，程序最多自动建 8 级…」
///   Err(e)                 → 红字 fail_text
/// ```
///
/// `probe` 自己的三档语义（`Reachable` / `NoDirectoryListing`）**没变**：后者的信息量
/// （「服务端不支持直接读目录，但同步单个文件不受影响」）追加在绿字末尾，别丢。
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
    /* 第一关：地址与凭据。`NoDirectoryListing` 也是通过——同步 GET 的是 `{date}.md`
    这个具体文件，服务端不肯对目录发 GET 不影响这条通道。 */
    let listing = match md_webdav::probe(&target, "").await {
        Ok(md_webdav::ProbeOutcome::Reachable) => None,
        Ok(md_webdav::ProbeOutcome::NoDirectoryListing(code)) => Some(code),
        Err(err) => return verdict(false, round_push::fail_text(&err, &target.base_path)),
    };
    /* 第二关：目录就绪。这才证明「能写」，也是本轮修 409 的落地点。 */
    let (mut detail, ok) = match md_webdav::dir::ensure_base_dir(&target).await {
        Ok(md_webdav::dir::EnsureOutcome::Ready { created: 0, .. }) => (
            format!(
                "连接正常，云端目录{}已就绪",
                round_push::dir_label(&target.base_path)
            ),
            true,
        ),
        Ok(md_webdav::dir::EnsureOutcome::Ready { created, .. }) => (
            format!(
                "连接正常，已补建云端目录{}（新建 {created} 级）",
                round_push::dir_label(&target.base_path)
            ),
            true,
        ),
        Ok(md_webdav::dir::EnsureOutcome::TooDeep { levels }) => (
            format!(
                "远端目录{}有 {levels} 级，程序最多自动建 {} 级；\
                 请到网盘网页版手动建好，或把目录改浅一点",
                round_push::dir_label(&target.base_path),
                md_webdav::dir::MAX_LEVELS
            ),
            false,
        ),
        Err(err) => (round_push::fail_text(&err, &target.base_path), false),
    };
    if let Some(code) = listing {
        if ok {
            detail.push_str(&format!("（服务端不支持直接读目录，{code} 已按正常处理）"));
        }
    }
    verdict(ok, detail)
}
