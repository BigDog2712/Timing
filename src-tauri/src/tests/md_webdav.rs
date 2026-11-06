//! `infra::md_webdav` 的分支覆盖（任务书 §4.5 + 设计 §2.6）。
//!
//! 假服务器用 `std::net::TcpListener` 手写：读满一个请求（含 body）→ 写死响应 → 关连接。
//! `auth_header_uses_raw_utf8_bytes` 是唯一证明「非 ASCII 账号密码能连上坚果云」的证据。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use crate::infra::md_webdav::{get, put, redact, WebdavError, WebdavTarget};

/// 假服务器句柄。`pub(crate)` 是为了让 `tests::md_cloud_round` 的 412 重试用同一份实现
/// （那边要真 HTTP 才能证「重试了一次」，自己再写一份 TCP 桩只会让两份慢慢走偏）。
pub(crate) struct Fake {
    pub(crate) base_url: String,
    pub(crate) seen: Arc<Mutex<Vec<String>>>,
}

impl Fake {
    /// 第 `index` 个请求的原文（含请求行与全部头）。
    pub(crate) fn request(&self, index: usize) -> String {
        self.seen.lock().expect("假服务器记录锁")[index].clone()
    }

    /// 收到的请求数。用来断言「只重试了一次」——多一次少一次都是行为错误。
    pub(crate) fn count(&self) -> usize {
        self.seen.lock().expect("假服务器记录锁").len()
    }
}

/// 起一个只回一种响应的假服务器。`headers` 里每行都要自带 `\r\n`。
pub(crate) fn serve(status_line: &'static str, headers: &'static str, body: &'static [u8]) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").expect("本地端口应可绑定");
    let port = listener.local_addr().expect("应能取到本地地址").port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let head = format!(
        "HTTP/1.1 {status_line}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let raw = read_request(&mut stream);
            log.lock().expect("假服务器记录锁").push(raw);
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
            let _ = stream.flush();
        }
    });
    Fake {
        base_url: format!("http://127.0.0.1:{port}"),
        seen,
    }
}

/// 读到 `\r\n\r\n` 只是头结束；PUT 还带 body，必须按 `Content-Length` 读满，
/// 否则 reqwest 会在写 body 时撞上「连接已关闭」。
fn read_request(stream: &mut TcpStream) -> String {
    let mut raw: Vec<u8> = Vec::new();
    let mut buf = [0u8; 2048];
    loop {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(read) => raw.extend_from_slice(&buf[..read]),
        }
        if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            let head_end = end + 4;
            let need = content_length(&raw[..end]).map_or(head_end, |len| head_end + len);
            if raw.len() >= need {
                break;
            }
        }
    }
    String::from_utf8_lossy(&raw).to_string()
}

fn content_length(head: &[u8]) -> Option<usize> {
    let text = String::from_utf8_lossy(head);
    text.split("\r\n").find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case("content-length") {
            return None;
        }
        value.trim().parse::<usize>().ok()
    })
}

pub(crate) fn header_value(raw: &str, name: &str) -> Option<String> {
    raw.split("\r\n").find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

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
/// 且文案说的是「检查密码或流量」，`Server(403)` 只会说「稍后自动重试」——把用户
/// 引向永远不会好的等待。
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

#[test]
fn redact_masks_userinfo() {
    assert_eq!(
        redact("https://u:p@dav.jianguoyun.com/dav"),
        "https://***@dav.jianguoyun.com/dav"
    );
    let plain = "https://dav.jianguoyun.com/dav";
    assert_eq!(redact(plain), plain, "没有 userinfo 时不许动");
}

/// 「GET 回正文 + ETag、PUT 一律 412」的假服务器。
///
/// 412 那条补救路径（重拉 → 重跑合并 → 再 PUT 一次）必须用真 HTTP 才验得动：它的
/// 输入就是「PUT 被拒」这件事本身，用桩替换掉就等于什么都没测。
pub(crate) fn serve_412_on_put(body: &'static [u8], etag: &'static str) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").expect("本地端口应可绑定");
    let port = listener.local_addr().expect("应能取到本地地址").port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let raw = read_request(&mut stream);
            let is_put = raw.starts_with("PUT ");
            log.lock().expect("假服务器记录锁").push(raw);
            let head = if is_put {
                "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string()
            } else {
                format!(
                    "HTTP/1.1 200 OK\r\nETag: {etag}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
            };
            let _ = stream.write_all(head.as_bytes());
            if !is_put {
                let _ = stream.write_all(body);
            }
            let _ = stream.flush();
        }
    });
    Fake {
        base_url: format!("http://127.0.0.1:{port}"),
        seen,
    }
}
