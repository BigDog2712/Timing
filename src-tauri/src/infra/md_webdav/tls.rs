//! 云端通道的 TLS 后端（[V0.11.25]）。
//!
//! ## 为什么不再用「系统根证书」
//!
//! reqwest 0.13 的 `rustls-no-provider` 会拖 `rustls-platform-verifier`。它在 Windows /
//! macOS 上就近读系统证书，**但 Android 上必须先由 Kotlin 侧的 `RustlsPlatformVerifier`
//! 初始化 context**（那是 `rustls-platform-verifier-android` 这个 AAR 提供的类，本项目没有
//! 引）。没初始化就去验证，它内部 `global().expect("Expect rustls-platform-verifier to be
//! initialized")` 直接 panic；而 `release` 是 `panic = "abort"` → 整个进程被带走。
//!
//! 症状因此长成：**手机点「测试连接」就闪退，桌面一切正常**。桌面用例也永远发现不了——
//! 它们用的是本地假 HTTP 服务端，连证书校验都走不到。
//!
//! ## 换成什么
//!
//! 根证书改成编译期内置（`webpki-roots`）：两端同一份、无 JNI、无运行时初始化，
//! 也就不存在「忘了初始化」这种失败模式。代价写在 `06-已知边界与坑`：企业自签 /
//! 内网私有 CA 签的证书不认。
//!
//! ## 为什么不 panic
//!
//! `release` 的 `panic = "abort"` 意味着任何一次 `expect` 都是「用户点一下、App 没了」。
//! 因此这里全部走 `Result`：建不出来就如实回一句，让界面出红字——出错可以重试，
//! 进程没了就只能重装。

use std::sync::Arc;

/// 内置的根证书集合。
///
/// 单独抽出来是为了**可断言**：`ClientConfig` 不暴露根证书数量，而「表被清空了」
/// 正好是这轮事故最容易复发的方式（换回平台验证器、或忘了 `extend`）。用例断言它的
/// `len()`，变异自检才红得起来。
pub fn root_store() -> rustls::RootCertStore {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    roots
}

/// 用内置根证书的 rustls 配置。
///
/// 失败只可能是 rustls 自己的协议版本枚举与 provider 不匹配（编译期常量，实际不会发生），
/// 仍然如实回错误而不是 `unwrap`——见模块头「为什么不 panic」。
pub fn client_config() -> Result<rustls::ClientConfig, String> {
    /* provider 只在这里装一次。`install_default` 在已装过时返回 `Err`，忽略即可：
    进程级只能有一个，谁先装谁生效，而三处 Client 用的是同一个 provider。 */
    let _ = rustls::crypto::ring::default_provider().install_default();
    Ok(rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|err| format!("TLS 配置不可用：{err}"))?
    .with_root_certificates(root_store())
    .with_no_client_auth())
}

/// 装好 TLS 的 `ClientBuilder`。三处 Client（GET/PUT、MKCOL、DELETE）共用这一份，
/// 各自的差别只有超时与重定向策略。
pub fn builder() -> Result<reqwest::ClientBuilder, String> {
    Ok(reqwest::Client::builder().use_preconfigured_tls(client_config()?))
}
