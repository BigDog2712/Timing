//! 路由式假 WebDAV 服务器（设计 §6.2）：按**请求方法 + 路径**回应，并记住已建的目录。
//!
//! `fake_webdav.rs::serve` 只回写死响应，无法表达「目录不存在 → PUT 409 / MKCOL 201 →
//! 之后 PUT 200」这条因果链——而 409 修复的整个判据就是这条链。所以这里按目录集合
//! 路由，`dirs` 是服务器的**真实状态**，不是脚本。
//!
//! ## 路由表（每次请求一行判定，顺序即优先级）
//!
//! | 方法 | 条件 | 回应 |
//! |---|---|---|
//! | `MKCOL` | 有 override（全局或按路径） | 该状态码 |
//! | `MKCOL` | `path ∈ dirs` | 405（RFC：集合已存在） |
//! | `MKCOL` | `parent(path) ∉ dirs` | 409（父级缺失） |
//! | `MKCOL` | 否则 | `dirs.insert(path)` → 201 |
//! | `PUT` | `parent(path) ∉ dirs` | 409 |
//! | `PUT` | 否则 | `put_status`（默认 201）+ `ETag` |
//! | 其余 | — | 404（今天还没记，正常结果） |
//!
//! ## 不变式：`""` 恒在 `dirs` 里
//!
//! `parent("/Timing")` = `""`，而根目录永远存在。少了这条不变式，假服务器会造出
//! 「第一级也 409」这种真实服务端不可能出现的组合，而用例会照着假规则绿。
//!
//! ## 3xx 一定带 `Location`
//!
//! `mkcol_301_counts_as_existing_without_following` 要证明「没跟随重定向」。不带
//! `Location` 的 301 任何客户端都跟不了，那条用例就等于没测。带上 `Location` 之后，
//! 若 `Policy` 没设成 `none()`，reqwest 会**改成 GET** 再发一次，`hits()` 立刻多一条。

use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use crate::tests::fake_webdav::read_request;

/// 一个请求的记录。`method` / `path` 取自请求行，`raw` 是全文（含头）。
#[derive(Debug, Clone)]
pub(crate) struct Hit {
    pub method: String,
    pub path: String,
    pub raw: String,
}

pub(crate) struct DirServer {
    pub base_url: String,
    seen: Arc<Mutex<Vec<Hit>>>,
    dirs: Arc<Mutex<HashSet<String>>>,
    /// `"*"` = 所有 MKCOL 都回这个码；其余键是**具体路径**。
    mkcol_fail: Arc<Mutex<HashMap<String, u16>>>,
    put_status: Arc<Mutex<u16>>,
}

impl DirServer {
    /// 起服务器。`initial_dirs` 是**已存在**的目录路径（无尾斜杠）；根 `""` 自动加上。
    pub(crate) fn new(initial_dirs: &[&str]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("本地端口应可绑定");
        let port = listener.local_addr().expect("应能取到本地地址").port();
        let seen: Arc<Mutex<Vec<Hit>>> = Arc::new(Mutex::new(Vec::new()));
        let dirs: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(
            std::iter::once(String::new())
                .chain(initial_dirs.iter().map(|dir| (*dir).to_string()))
                .collect(),
        ));
        let mkcol_fail: Arc<Mutex<HashMap<String, u16>>> = Arc::new(Mutex::new(HashMap::new()));
        let put_status: Arc<Mutex<u16>> = Arc::new(Mutex::new(201));

        let (log, dirs_in, fail_in, put_in) = (
            seen.clone(),
            dirs.clone(),
            mkcol_fail.clone(),
            put_status.clone(),
        );
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let raw = read_request(&mut stream);
                let (method, path) = request_line(&raw);
                log.lock().expect("假服务器记录锁").push(Hit {
                    method: method.clone(),
                    path: path.clone(),
                    raw,
                });
                let (code, extra) = route(&method, &path, &dirs_in, &fail_in, &put_in);
                let head = format!(
                    "HTTP/1.1 {code} {}\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n",
                    reason(code)
                );
                let _ = std::io::Write::write_all(&mut stream, head.as_bytes());
                let _ = std::io::Write::flush(&mut stream);
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            seen,
            dirs,
            mkcol_fail,
            put_status,
        }
    }

    /// 所有 MKCOL 都回 `code`（`403` / `301` 这类「整条链都错」的判据用）。
    pub(crate) fn fail_mkcol_with(&self, code: u16) -> &Self {
        self.mkcol_fail
            .lock()
            .expect("假服务器状态锁")
            .insert("*".to_string(), code);
        self
    }

    /// 只有 `path` 这一级的 MKCOL 回 `code`（钉「第 1 级成功、第 2 级失败就立刻停」）。
    pub(crate) fn fail_mkcol_at(&self, path: &str, code: u16) -> &Self {
        self.mkcol_fail
            .lock()
            .expect("假服务器状态锁")
            .insert(path.to_string(), code);
        self
    }

    /// PUT 一律回 `code`（`409` 用来钉「补建之后仍 409 不许改写成语义」）。
    pub(crate) fn fail_put_with(&self, code: u16) -> &Self {
        *self.put_status.lock().expect("假服务器状态锁") = code;
        self
    }

    pub(crate) fn hits(&self) -> Vec<Hit> {
        self.seen.lock().expect("假服务器记录锁").clone()
    }

    /// `["PUT /Timing/md/…md", "MKCOL /Timing", "MKCOL /Timing/md", "PUT /…"]`
    ///
    /// 断言「发了哪些请求、顺序如何」远强于断言「最后一个状态码」：前者同时钉住
    /// 「只重试一次」与「浅 → 深」两条纪律。
    pub(crate) fn method_paths(&self) -> Vec<String> {
        self.hits()
            .into_iter()
            .map(|hit| format!("{} {}", hit.method, hit.path))
            .collect()
    }

    /// 服务器端现在真的存在哪些目录（不含根 `""`）。
    pub(crate) fn dirs(&self) -> Vec<String> {
        let mut out: Vec<String> = self
            .dirs
            .lock()
            .expect("假服务器状态锁")
            .iter()
            .filter(|dir| !dir.is_empty())
            .cloned()
            .collect();
        out.sort();
        out
    }
}

fn request_line(raw: &str) -> (String, String) {
    let mut parts = raw.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    (method, path)
}

/// 去掉最后一段。`parent("/Timing")` = `""`（根）。
fn parent(path: &str) -> String {
    match path.rfind('/') {
        Some(0) | None => String::new(),
        Some(at) => path[..at].to_string(),
    }
}

fn route(
    method: &str,
    path: &str,
    dirs: &Arc<Mutex<HashSet<String>>>,
    mkcol_fail: &Arc<Mutex<HashMap<String, u16>>>,
    put_status: &Arc<Mutex<u16>>,
) -> (u16, String) {
    match method {
        "MKCOL" => {
            let forced = {
                let fail = mkcol_fail.lock().expect("假服务器状态锁");
                fail.get(path).or_else(|| fail.get("*")).copied()
            };
            let mut dirs = dirs.lock().expect("假服务器状态锁");
            let code = match forced {
                Some(code) => code,
                None if dirs.contains(path) => 405,
                None if !dirs.contains(&parent(path)) => 409,
                None => {
                    dirs.insert(path.to_string());
                    201
                }
            };
            /* 3xx 一定带 `Location`：见模块头「3xx 一定带 Location」。 */
            let extra = if (300..400).contains(&code) {
                format!("Location: {path}\r\n")
            } else {
                String::new()
            };
            (code, extra)
        }
        "PUT" => {
            let exists = dirs
                .lock()
                .expect("假服务器状态锁")
                .contains(&parent(path));
            if !exists {
                return (409, String::new());
            }
            let code = *put_status.lock().expect("假服务器状态锁");
            if code == 201 {
                (201, "ETag: W/\"fake-1\"\r\n".to_string())
            } else {
                (code, String::new())
            }
        }
        _ => (404, String::new()),
    }
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        409 => "Conflict",
        423 => "Locked",
        _ => "Status",
    }
}
