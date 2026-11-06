//! Android 侧凭据存储：转调 Kotlin 的 `secretPut` / `secretGet` / `secretClear`。
//!
//! 原生侧用 Keystore 派生的 AES 密钥做 AES-GCM，密文（含 IV）Base64 后进
//! `SharedPreferences`（文件名 `timing-secret`）。密钥不出 Keystore，Rust 只搬运字符串。
//!
//! ## 为什么异常一律折成一句话
//!
//! 桥抛出来的原文常常是 `java.security.UnrecoverableKeyException: ...` 之类，对用户零信息量。
//! 原文进 WARN 日志（排障要），界面与上层拿到的是统一口径 `MISSING`——与桌面 DPAPI 一致，
//! 于是编排层只需要认一句话。
//!
//! **本模块只在 Android 构建里编译**（`infra/mod.rs` 用 `#[cfg(mobile)]` 门控），
//! 桌面 `cargo test` 覆盖不到；Kotlin 侧同理，只能在 Android 构建时暴露问题。

use serde::{Deserialize, Serialize};
use tauri::plugin::PluginHandle;
use tauri::Wry;

use crate::infra::secret::MISSING;

#[derive(Serialize)]
struct KeyPayload<'a> {
    key: &'a str,
}

#[derive(Serialize)]
struct PutPayload<'a> {
    key: &'a str,
    value: &'a str,
}

/// Kotlin 在没有值时**不放** `value` 键，于是这里自然是 `None`。
#[derive(Deserialize)]
struct ValueReply {
    #[serde(default)]
    value: Option<String>,
}

/// 读一个键。空串按「没存过」处理：设置页清空密码框后写入的就是空串。
pub async fn get(handle: &PluginHandle<Wry>, key: &str) -> Result<Option<String>, String> {
    let reply: ValueReply = handle
        .run_mobile_plugin_async("secretGet", KeyPayload { key })
        .await
        .map_err(fail)?;
    Ok(reply.value.filter(|value| !value.is_empty()))
}

pub async fn put(handle: &PluginHandle<Wry>, key: &str, value: &str) -> Result<(), String> {
    /* 回值形态不参与判断：能把 `resolve` 等到就说明原生侧写完了。
    这样 Kotlin 将来改回值形状（加字段/改成空对象）不会让这条链路突然报错。 */
    let _: serde_json::Value = handle
        .run_mobile_plugin_async("secretPut", PutPayload { key, value })
        .await
        .map_err(fail)?;
    Ok(())
}

pub async fn clear(handle: &PluginHandle<Wry>, key: &str) -> Result<(), String> {
    let _: serde_json::Value = handle
        .run_mobile_plugin_async("secretClear", KeyPayload { key })
        .await
        .map_err(fail)?;
    Ok(())
}

/// 把桥的异常折成统一口径，原文落 WARN 日志。
fn fail(err: tauri::plugin::mobile::PluginInvokeError) -> String {
    crate::log_warn!("secret bridge failed: {err}");
    MISSING.to_string()
}
