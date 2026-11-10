//! `infra::md_webdav` 的分支覆盖（任务书 §4.5 + 设计 §2.6）。
//!
//! 假服务器在 `fake_webdav.rs`（V0.11.15 拆出，只为行数；本文件曾贴着 300 行门禁）。
//! 这里只留「GET / PUT / probe / auth / redact」的判据，一条用例一档结论。
//!
//! `auth_header_uses_raw_utf8_bytes` 是唯一证明「非 ASCII 账号密码能连上坚果云」的证据。
//! MKCOL 与「409 补建重试」的判据在 `md_webdav_dir.rs`。

use crate::infra::md_webdav::{get, probe, put, redact, ProbeOutcome, WebdavError, WebdavTarget};
use super::fake_webdav::{header_value, serve, Fake};

/// 落点固定为 `/Timing/md/`（带首尾斜杠）：顺带钉住 `normalize_path`。
fn target(fake: &Fake, user: &str, password: &str) -> WebdavTarget {
    WebdavTarget::new(&fake.base_url, "/Timing/md/", user, password)
}

#[tokio::test]
async fn get_200_returns_bytes_and_etag() {
    let fake = serve("200 OK", "ETag: W/\"abc\"\r\n", "# 日记".as_bytes());
    let got = get(&target(&fake, "u", "p"), "2026-11-06.md")
        .await
        .expect("200 应成功");

    assert_eq!(got.bytes, "# 日记".as_bytes().to_vec(), "正文要原样交回");
    assert_eq!(got.etag.as_deref(), Some("W/\"abc\""));
    let raw = fake.request(0);
    assert!(
        raw.starts_with("GET /Timing/md/2026-11-06.md "),
        "base_path 要规范成单斜杠：{raw}"
    );
}

#[tokio::test]
async fn get_404_is_not_found() {
    let fake = serve("404 Not Found", "", b"");
    let err = get(&target(&fake, "u", "p"), "2026-11-06.md")
        .await
        .expect_err("404 应失败");
    assert_eq!(err, WebdavError::NotFound, "404 是「今天没记」，不是网络错误");
}

#[tokio::test]
async fn put_412_is_precondition_and_sends_if_match() {
    let fake = serve("412 Precondition Failed", "", b"");
    let err = put(&target(&fake, "u", "p"), "a.md", b"x", Some("W/\"abc\""))
        .await
        .expect_err("412 应失败");
    assert_eq!(err, WebdavError::Precondition);
    let raw = fake.request(0);
    assert_eq!(header_value(&raw, "if-match").as_deref(), Some("W/\"abc\""), "If-Match 要真发出去");
}

#[tokio::test]
async fn get_429_is_rate_limited() {
    let fake = serve("429 Too Many Requests", "", b"");
    let err = get(&target(&fake, "u", "p"), "a.md")
        .await
        .expect_err("429 应失败");
    assert_eq!(err, WebdavError::RateLimited);
}

#[tokio::test]
async fn get_401_is_auth() {
    let fake = serve("401 Unauthorized", "", b"");
    let err = get(&target(&fake, "u", "p"), "a.md")
        .await
        .expect_err("401 应失败");
    assert_eq!(err, WebdavError::Auth);
}

/// 403 是坚果云最常见的失败之一（本月上传流量用尽 / 应用密码权限被撤）。
/// 它必须落到 `Forbidden` 而不是 `Server(403)`：`Forbidden` 在编排层算「整轮到此为止」
/// 且文案说的是「检查权限 / 上传量」，`Server(403)` 只会说「服务拒绝了这次写入」——
/// 把用户引向永远不会好的等待。
#[tokio::test]
async fn get_403_is_forbidden() {
    let fake = serve("403 Forbidden", "", b"");
    let err = get(&target(&fake, "u", "p"), "a.md")
        .await
        .expect_err("403 应失败");
    assert_eq!(err, WebdavError::Forbidden);
}

/// PUT 也会遇到 403（写权限没了 / 流量用尽），同样不能退化成 `Server`。
#[tokio::test]
async fn put_403_is_forbidden() {
    let fake = serve("403 Forbidden", "", b"");
    let err = put(&target(&fake, "u", "p"), "a.md", b"x", None)
        .await
        .expect_err("403 应失败");
    assert_eq!(err, WebdavError::Forbidden);
}

/// 非 ASCII 账号密码必须按**原始 UTF-8 字节**做 Base64。
/// 期望值：`用户:密码@2024` → `Basic 55So5oi3OuWvhueggUAyMDI0`。
#[tokio::test]
async fn auth_header_uses_raw_utf8_bytes() {
    let fake = serve("200 OK", "", b"");
    get(&target(&fake, "用户", "密码@2024"), "2026-11-06.md")
        .await
        .expect("200 应成功");

    assert_eq!(
        header_value(&fake.request(0), "authorization").as_deref(),
        Some("Basic 55So5oi3OuWvhueggUAyMDI0"),
        "percent-encode 后再 base64 会得到另一串，坚果云只回 401 且不说原因"
    );
}

/// 「测试连接」的三档结论（[V0.11.14] 修 O8）：200/404 通、405/3xx 通但读不了目录、
/// 401 才是凭据不对。三种输入各一条，缺一档就等于没验分类表。
///
/// 先钉「通」的两档：只验错误档的话，把 `Ok(_) | NotFound` 也改成报错，四条错误档用例
/// 仍然全绿，而用户会看到「都连不上」。
#[tokio::test]
async fn probe_200_and_404_are_reachable() {
    let found = serve("200 OK", "", "# 日记".as_bytes());
    assert_eq!(
        probe(&target(&found, "u", "p"), "").await.expect("200 必须算通"),
        ProbeOutcome::Reachable
    );
    let missing = serve("404 Not Found", "", b"");
    assert_eq!(
        probe(&target(&missing, "u", "p"), "")
            .await
            .expect("404 只说明今天那份还没建，目录与鉴权已经验过"),
        ProbeOutcome::Reachable
    );
}

#[tokio::test]
async fn probe_405_is_reachable_but_cannot_list_the_directory() {
    let fake = serve("405 Method Not Allowed", "", b"");
    let outcome = probe(&target(&fake, "u", "p"), "")
        .await
        .expect("405 发生在鉴权之后，不是「连不上」");
    assert_eq!(
        outcome,
        ProbeOutcome::NoDirectoryListing(405),
        "405 必须自成一档：判成错误会让用户去改一个本来就对的地址"
    );
}

#[tokio::test]
async fn probe_301_is_reachable_but_cannot_list_the_directory() {
    /* 不带 `Location`：reqwest 默认会自己跟随带 Location 的 3xx，那种情形根本到不了
    这一层（会变成跟随后那个状态码）。这里钉的是「3xx 不许被翻成凭据错误」。 */
    let fake = serve("301 Moved Permanently", "", b"");
    let outcome = probe(&target(&fake, "u", "p"), "")
        .await
        .expect("3xx 是「要跳转」，不是「凭据不对」");
    assert_eq!(outcome, ProbeOutcome::NoDirectoryListing(301));
}

#[tokio::test]
async fn probe_401_stays_a_credential_error() {
    let fake = serve("401 Unauthorized", "", b"");
    let err = probe(&target(&fake, "u", "p"), "")
        .await
        .expect_err("401 必须仍是错误，否则「凭据不对」会被说成「通了」");
    assert_eq!(err, WebdavError::Auth, "凭据不对这一档不能和 405 混在一起");
}

#[test]
fn redact_masks_userinfo() {
    assert_eq!(
        redact("https://u:p@dav.jianguoyun.com/dav"),
        "https://***@dav.jianguoyun.com/dav"
    );
    let plain = "https://dav.jianguoyun.com/dav";
    assert_eq!(redact(plain), plain, "没有 userinfo 时不许动");
}

