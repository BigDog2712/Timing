//! WebDAV 应用密码在命令层的落地口径（V0.11.13，ADR-061 §2.5）。
//!
//! 桌面的 `md_sync_save` / `md_sync_test` 与移动端的同名命令必须**完全一样**地处理密码，
//! 否则同一份设置 JSON 在两个平台上会得到不同的凭据状态。三分语义因此只写在这一处：
//!
//! - `Some("")`：用户清空了密码框再保存 → 删掉已存密文（`secret::clear`）；
//!   判定用 `trim()`，与 `round_webdav` 的「密码是空的」同一口径——用户手滑打了个空格，
//!   存进 DPAPI 后同步会稳定报「应用密码是空的」，而设置页显示的 `hasSecret: true`
//!   会让他以为密码存好了。两处口径必须一致，所以空格按**清空**处理（这是唯一能让两边
//!   都自洽的选择：拒绝保存会让「只想清掉密码」的用户填不进空格，且拒绝的理由也说不清）；
//! - `Some(明文)`：新密码 → 写密文（`secret::put`）；
//! - `None`：用户没碰密码框 → **一个字节都不动**。这是「改别的设置别把密码清掉」的
//!   唯一保障：设置页回填的是 `hasSecret: bool`，它手里没有明文可以再传一遍。
//!
//! 密码本身绝不进 `MdSyncConfig`、绝不进 `settings` 表、绝不进日志，也不出现在任何
//! `Debug` / 错误文案里——本模块是它唯一的过手点。

use crate::error::{AppError, AppResult};
use crate::infra::secret::{self as keychain, KEY_WEBDAV};

/// 按三分语义落地密码。调用方必须保证它跑在**写配置之前**（见下）。
pub async fn apply(secret: Option<String>) -> AppResult<()> {
    match secret {
        None => Ok(()),
        Some(value) if value.trim().is_empty() => keychain::clear(KEY_WEBDAV)
            .await
            .map_err(|err| failure(&err, "清除")),
        Some(value) => keychain::put(KEY_WEBDAV, &value)
            .await
            .map_err(|err| failure(&err, "保存")),
    }
}

/// 凭据层失败回 `MD_SYNC_REMOTE_ERROR`，**不回** `IO_ERROR`。
///
/// 理由：`IO_ERROR` 的文案是「系统调用失败，请重试」，用户读完不知道「密码其实没存
/// 下来」。他以为存好了，下一轮同步拿旧密码（或没有密码）去连，收到 401 后再去改密码
/// 一次，问题依旧。这条码的文案是「原样透出」，所以把凭据层的原话带出去，并点明
/// 「本轮设置未保存」——`apply` 的调用点都排在写配置之前，这句话因此是事实，而不是
/// 安慰。`err` 来自 `infra::secret`，里面只有故障说明，没有密码。
fn failure(err: &str, action: &str) -> AppError {
    AppError::md_sync_remote(format!(
        "应用密码{action}失败：{err}；本轮设置未保存，请重试"
    ))
}
