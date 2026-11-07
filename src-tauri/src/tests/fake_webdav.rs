//! 假 WebDAV 服务器（从 `tests/md_webdav.rs` 逐字搬出，只为行数）。
//!
//! 用 `std::net::TcpListener` 手写：读满一个请求（含 body）→ 写死响应 → 关连接。
//! 两个工厂各管一种形状：
//! - `serve`：**所有**请求都回同一份写死响应（钉状态码分类表用）；
//! - `serve_412_on_put`：GET 回正文 + ETag、PUT 一律 412（钉「重拉 → 再合并 → 再 PUT」
//!   那条补救路径——它的输入就是「PUT 被拒」这件事本身）。
//!
//! `auth_header_uses_raw_utf8_bytes`（在 `md_webdav.rs`）是唯一证明「非 ASCII 账号密码
//! 能连上坚果云」的证据，它读的也是这份实现。
//!
//! 需要「按方法 + 路径路由」的假服务器在 `fake_webdav_dir.rs`：MKCOL 的判据是
//! 「目录存不存在」，写死响应表达不了。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

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

/// 读到 `\r\n\r\n` 只是头结束；PUT 还带 body，必须按 `Content-Length` 读满，
/// 否则 reqwest 会在写 body 时撞上「连接已关闭」。
///
/// `pub(crate)`：`fake_webdav_dir.rs` 的路由式服务器复用同一份读法——两份实现迟早
/// 会在「MKCOL 的空 body」这种边界上分叉。
pub(crate) fn read_request(stream: &mut TcpStream) -> String {
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
