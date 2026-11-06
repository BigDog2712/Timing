//! WebDAV 传输层（V0.11.13，ADR-061）：只有 GET / PUT / probe 三个动作。
//!
//! `{date}.md` 一天一个文件，路径能直接算（`md_file::expand_tokens`），所以不引 WebDAV
//! 客户端库、也不发 PROPFIND：坚果云单次列举上限 750 条且不支持 infinity PROPFIND，
//! 「先列目录再逐个比时间戳」正是 Remotely Save 慢的根因。只认 `WebdavTarget`，不认
//! `MdSyncCloud`、不引用 `services`（L4）；什么时候连、退避多久属编排层。
//! Basic Auth 一律走 `RequestBuilder::basic_auth()`：reqwest 把 `user:password` 按**原始
//! UTF-8 字节**做 base64 并 `set_sensitive(true)`。**绝不手拼 `Authorization`、绝不
//! percent-encode**——坚果云对百分号编码过的账号密码只回 401 且不说明原因（机器证据见
//! `tests/md_webdav.rs::auth_header_uses_raw_utf8_bytes`）。死码：调用点在 T03。

#![allow(dead_code)]

use std::fmt;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{ETAG, IF_MATCH};
use reqwest::{Client, StatusCode};

use crate::models::constants::{MD_CLOUD_CONNECT_SECS, MD_CLOUD_READ_SECS};

/// 服务端日志里能分辨出是谁在写。版本号随 `Cargo.toml` 走，不单独维护一份——
/// [V0.11.13] 硬编码 `"Timing/0.11.13"` 那种写法下次升版必忘。
const USER_AGENT: &str = concat!("Timing/", env!("CARGO_PKG_VERSION"));

/// 一次 WebDAV 调用的全部参数。`password` 是**应用密码**（坚果云登录密码必然失败）。
#[derive(Clone)]
pub struct WebdavTarget {
    pub base_url: String,
    pub base_path: String,
    pub user: String,
    pub password: String,
}

/// 传输层错误。上层据此决定「退避 / 跳过 / 放弃本轮」，本层不做任何策略。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebdavError {
    Auth,
    Forbidden,
    RateLimited,
    Precondition,
    NotFound,
    Timeout,
    /// 连不上、DNS、TLS、非法参数。`message` 已过 `redact`，可安全落日志。
    Network(String),
    /// 其余 4xx / 5xx 原样带出状态码。
    Server(u16),
}

/// GET 结果：正文 + 下一次 PUT 要用的 `If-Match` 依据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetOutcome {
    pub bytes: Vec<u8>,
    pub etag: Option<String>,
}

/// PUT 结果：服务端换了新 ETag 时带回来。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutOutcome {
    pub etag: Option<String>,
}

impl WebdavTarget {
    /// `base_path` 在这里就规范成「有前导斜杠、无尾斜杠」，`url_for` 不再做判断。
    pub fn new(base_url: &str, base_path: &str, user: &str, password: &str) -> Self {
        Self {
            base_url: base_url.trim().to_string(),
            base_path: normalize_path(base_path),
            user: user.to_string(),
            password: password.to_string(),
        }
    }

    /// `base_url` + 规范化目录 + 百分号编码后的 `rel`。`rel` 允许为空（`probe` 要测目录本身）。
    /// 本机参数不合法返回 `Network` 而不新增变体：多一个变体会让编排层的 match 多一条
    /// 永远走不到的分支。
    pub fn url_for(&self, rel: &str) -> Result<String, WebdavError> {
        let base = self.base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return Err(WebdavError::Network("WebDAV 地址还没填".into()));
        }
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err(WebdavError::Network(format!(
                "WebDAV 地址要以 http(s):// 开头：{}",
                redact(base)
            )));
        }
        let rel = rel.trim().trim_start_matches('/');
        if rel.split('/').any(|segment| segment == "..") {
            return Err(WebdavError::Network("远端相对路径不能包含 ..".into()));
        }
        let mut url = String::with_capacity(base.len() + self.base_path.len() + rel.len() + 2);
        url.push_str(base);
        url.push_str(&self.base_path);
        url.push('/');
        url.push_str(&encode_rel(rel));
        Ok(url)
    }
}

/// 手写 `Debug`：`password` 一个字都不出现——派生它会让密码在任何一句
/// `log_debug!("{target:?}")` 里明文落盘。
impl fmt::Debug for WebdavTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WebdavTarget")
            .field("base_url", &redact(&self.base_url))
            .field("base_path", &self.base_path)
            .field("user", &self.user)
            .finish()
    }
}

/// 取远端一份文件。404 是正常结果（今天还没记），由调用方解释。
pub async fn get(target: &WebdavTarget, rel: &str) -> Result<GetOutcome, WebdavError> {
    let url = target.url_for(rel)?;
    let response = client()
        .get(&url)
        .basic_auth(&target.user, Some(&target.password))
        .send()
        .await
        .map_err(map_reqwest)?;
    fail_on_status(response.status())?;
    let etag = etag_of(&response);
    let bytes = response.bytes().await.map_err(map_reqwest)?.to_vec();
    Ok(GetOutcome { bytes, etag })
}

/// 写远端一份文件。`if_match = Some(etag)` 时发 `If-Match`；`None` 就是无条件 PUT——
/// **不发** `If-None-Match: *`：那会把「覆盖已存在文件」变成 412，而覆盖是常态。
pub async fn put(
    target: &WebdavTarget,
    rel: &str,
    bytes: &[u8],
    if_match: Option<&str>,
) -> Result<PutOutcome, WebdavError> {
    let url = target.url_for(rel)?;
    let mut request = client()
        .put(&url)
        .basic_auth(&target.user, Some(&target.password))
        .body(bytes.to_vec());
    if let Some(etag) = if_match {
        request = request.header(IF_MATCH, etag);
    }
    let response = request.send().await.map_err(map_reqwest)?;
    fail_on_status(response.status())?;
    Ok(PutOutcome {
        etag: etag_of(&response),
    })
}

/// `probe` 的三类结论（[V0.11.14] 修 O8）。
///
/// 旧版只有「通 / 不通」两档，于是 405（服务端不支持对目录发 GET）与 3xx（要求补尾
/// 斜杠）被翻成「连不上」，用户以为自己填错了地址或密码，去改一个本来就对的配置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// 地址与凭据都对：200（读到正文），或 404（这个文件今天还没建）。
    Reachable,
    /// **通了**，但服务端不支持直接读这个路径：405 方法不允许，或 3xx 要求跳转。
    /// 带出原始状态码，好让上层文案能自证「你没填错」。
    NoDirectoryListing(u16),
}

/// 「这个地址和凭证能不能用」。判据分三档（见 `ProbeOutcome`）：200 / 404 算通，
/// 405 与 3xx 算「通但读不了目录」，其余仍是错误。
///
/// 为什么用状态码分类而不是改成 PROPFIND：reqwest 发自定义方法要 `Method::from_bytes`、
/// 还要处理 `207 Multi-Status` 的 XML，而坚果云 / 群晖 / Nextcloud 的 PROPFIND 返回
/// 互不一致（有的要 `Depth: 1`、有的对不存在的目录回 207 空集）。判据越复杂，出错时
/// 越难说清是「服务端怪」还是「我们写错」。状态码分类只有一张表，且能被假服务器逐档
/// 钉死（`tests/md_webdav.rs`）。同步本身 GET 的是 `{date}.md` 这个具体文件，不是
/// 目录，所以「读不了目录」不影响这条通道能不能用。
pub async fn probe(target: &WebdavTarget, rel: &str) -> Result<ProbeOutcome, WebdavError> {
    match get(target, rel).await {
        Ok(_) => Ok(ProbeOutcome::Reachable),
        Err(WebdavError::NotFound) => Ok(ProbeOutcome::Reachable),
        /* 405 = 服务端不认「GET 一个目录」这个方法；3xx = 要跳转（301 补尾斜杠是最常见
        的一种）。两者都发生在**鉴权通过之后**，所以绝不是「凭据不对」。
        reqwest 默认会自己跟随带 `Location` 的 3xx，因此真正落到这一档的，多是响应
        畸形（没有 `Location`）或跟随后仍被重定向的情形——留着这一档，是为了让「通但
        读不了目录」永远不会被表达成「连不上」。 */
        Err(WebdavError::Server(code)) if matches!(code, 405 | 300..=399) => {
            Ok(ProbeOutcome::NoDirectoryListing(code))
        }
        Err(err) => Err(err),
    }
}

/// 把 `scheme://user:pass@host/...` 的 userinfo 段抹成 `***@`。也用来洗 `reqwest` 的
/// 错误串（它会把整个 URL 带进消息里），所以不含 userinfo 的输入原样返回。
pub fn redact(url: &str) -> String {
    let Some(start) = url.find("://").map(|at| at + 3) else {
        return url.to_string();
    };
    let end = url[start..].find('/').map_or(url.len(), |at| start + at);
    match url[start..end].rfind('@') {
        Some(at) => format!("{}***@{}", &url[..start], &url[start + at + 1..]),
        None => url.to_string(),
    }
}

/// 复用一个 Client（连接池 + TLS 会话都在里面）。超时按任务书 §4.5：连 10s / 读 30s。
fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        /* `rustls-no-provider` 必须自己装加密提供者，否则 `build()` 建 TLS 配置时 panic
        （reqwest 0.13.5 `default_rustls_crypto_provider`）。用 ring：只需 cc，
        Windows 与 NDK 都能编，与 Cargo.toml 的选择一致。 */
        let _ = rustls::crypto::ring::default_provider().install_default();
        Client::builder()
            .connect_timeout(Duration::from_secs(MD_CLOUD_CONNECT_SECS))
            .timeout(Duration::from_secs(MD_CLOUD_READ_SECS))
            .user_agent(USER_AGENT)
            .build()
            /* 建 Client 失败只可能是系统 TLS 配置坏了。**不** panic：release 是
            `panic = "abort"`，一次构造失败会带走整个进程。退回默认 Client 只是丢掉
            超时设置，那一轮同步还有自己的退避。 */
            .unwrap_or_else(|_| Client::new())
    })
}

/// 状态码 → 错误。成功 `Ok(())`；表外的 4xx / 5xx 一律 `Server(code)`。
fn fail_on_status(status: StatusCode) -> Result<(), WebdavError> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status {
        StatusCode::UNAUTHORIZED => WebdavError::Auth,
        StatusCode::FORBIDDEN => WebdavError::Forbidden,
        StatusCode::NOT_FOUND => WebdavError::NotFound,
        StatusCode::PRECONDITION_FAILED => WebdavError::Precondition,
        StatusCode::TOO_MANY_REQUESTS => WebdavError::RateLimited,
        other => WebdavError::Server(other.as_u16()),
    })
}

fn map_reqwest(err: reqwest::Error) -> WebdavError {
    if err.is_timeout() {
        return WebdavError::Timeout;
    }
    /* 错误串里带完整 URL（可能含用户填进 base_url 的 user:pass@），洗一遍再交出去：
    这串会被写进日志与「远端错误」提示。 */
    WebdavError::Network(redact(&err.to_string()))
}

fn etag_of(response: &reqwest::Response) -> Option<String> {
    let value = response.headers().get(ETAG)?;
    value.to_str().ok().map(str::to_string)
}

/// `base_path` 规范成「`/a/b`」或空串（空 = 直接写 base_url 根下）。
fn normalize_path(raw: &str) -> String {
    let trimmed = raw.trim().replace('\\', "/");
    let trimmed = trimmed.trim_matches('/').to_string();
    if trimmed.is_empty() { trimmed } else { format!("/{trimmed}") }
}

/// RFC 3986 百分号编码：非保留字符与 `/` 原样，其余按 UTF-8 字节逐字节编码。
/// 不引 `percent-encoding` / `urlencoding`——这点逻辑不值得多一个 crate。
fn encode_rel(rel: &str) -> String {
    let mut out = String::with_capacity(rel.len());
    for byte in rel.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
