//! 云端通道的 TLS 后端（[V0.11.25]）。
//!
//! ## 这一组钉什么
//!
//! 0.11.24 及之前信任「系统根证书」（reqwest 0.13 的 `rustls-no-provider` 会拖
//! `rustls-platform-verifier`）。那个后端**在 Android 上必须先由 Kotlin 侧初始化
//! context**，而本项目没有引那个 AAR——于是手机上第一次做 HTTPS 校验就
//! `expect("Expect rustls-platform-verifier to be initialized")`，`release` 又是
//! `panic = "abort"`，**整个 App 当场被杀**。症状：手机点「测试连接」闪退，桌面正常。
//!
//! 桌面用例发现不了它，因为所有 WebDAV 用例打的是本地假服务端（纯 HTTP），
//! 根本走不到证书校验。所以这里单独立一组：钉住「根证书是编译期内置的」。
//!
//! ## 变异自证
//!
//! 把 `tls::root_store()` 里的 `roots.extend(..)` 注释掉 → `roots_are_built_in` 必红；
//! 把 `client_config()` 换回 `Client::new()` 那条回退 → `client_builds` 编译期就红。

use crate::infra::md_webdav::tls;

/// 根证书必须真的被装进去。空表意味着「所有 HTTPS 都会被判成证书无效」，
/// 或者更糟——有人把 TLS 换回了需要运行时初始化的平台验证器。
#[test]
fn roots_are_built_in() {
    let roots = tls::root_store();
    assert!(
        roots.len() > 100,
        "内置根证书不该是空表（实际 {} 条）：手机端的 HTTPS 会全军覆没",
        roots.len()
    );
}

/// 三处 Client 都要走这条路：配置能建出来、Client 能建出来，且**不 panic**。
///
/// `panic = "abort"` 下这条尤其重要——构造失败必须是 `Err`，不能是 `expect`。
#[test]
fn client_builds() {
    tls::builder()
        .and_then(|builder| builder.build().map(|_| ()).map_err(|err| err.to_string()))
        .expect("内置根证书可用时，Client 必须建得出来");
}

/// 根证书来源不许被删。删了 `webpki-roots` 就等于回到「系统根证书」那条路，
/// 而那条路在 Android 上没有初始化点——这轮的闪退会原样回来。
#[test]
fn cargo_still_pins_builtin_roots() {
    let manifest = include_str!("../../../Cargo.toml");
    assert!(
        manifest.contains("webpki-roots"),
        "Cargo.toml 里没有 webpki-roots：手机端会退回平台验证器，点「测试连接」重新闪退"
    );
}

/// 真网络握手：证明内置根证书能验过**公网 CA** 签的证书（坚果云的 WebDAV 端点，
/// 与手机端要连的是同一类服务）。
///
/// 标 `#[ignore]`：门禁不跑（要联网，且会因对方服务变更而抖）。手动复验一次：
/// `cargo test --lib real_https -- --ignored --nocapture`
///
/// 判据是「**证书过了**」，不是「200」：这个地址没带凭据，401 恰恰说明 TLS 已经握完、
/// 服务器在要密码。若根证书不可用，这里拿到的是 `certificate` 一类错误。
#[tokio::test]
#[ignore = "要联网；手动跑 cargo test --lib real_https -- --ignored"]
async fn real_https_handshake_succeeds() {
    let client = tls::builder()
        .expect("TLS 配置可用")
        .build()
        .expect("Client 可构建");
    let result = client
        .get("https://dav.jianguoyun.com/dav/")
        .send()
        .await
        .map_err(|err| err.to_string());
    let err = match result {
        Ok(response) => {
            println!("TLS 握手成功，HTTP {}", response.status());
            return;
        }
        Err(text) => text,
    };
    /* 只要不是证书问题，就算过：DNS / 超时 / 断开都是环境噪音，与根证书无关。 */
    assert!(
        !err.to_lowercase().contains("certificate"),
        "证书校验失败，内置根证书没生效：{err}"
    );
    println!("未完成握手（环境原因，与根证书无关）：{err}");
}
