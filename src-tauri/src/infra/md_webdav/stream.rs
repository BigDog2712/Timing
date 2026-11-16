//! 事件流传输需要的两个 WebDAV 原语（V0.14.x，架构设计 §1.2）：
//! [`put_new`]（`If-None-Match` 防覆盖）与 [`list_children`]（PROPFIND depth-1 列直接子项）。
//!
//! 从 `mod.rs` 拆出：那里贴着 300 行门禁，而这两个原语是**新能力**——此前 md 层只有
//! GET / PUT / MKCOL，既没有「只写一次」的 PUT，也没有目录列举。事件流的不可变分段
//! 需要它们，md 的 `{date}.md` 快照用不到，所以单独一个文件，不污染既有路径。
//!
//! ## 为什么这里又发 PROPFIND（与 `mod.rs` 头「不发 PROPFIND」不矛盾）
//!
//! `mod.rs` 说「不发 PROPFIND」针对的是 md 那套「先列目录再逐个比时间戳」的反模式
//! （坚果云单次列举上限 750 条且不支持 infinity）。事件流的 [`list_children`] 只在
//! `sync/events/` 上发一次 depth-1，用途是**发现对端设备目录**（数量 = 设备数，个位数），
//! 不是逐个比文件时间戳；而分段文件本身的枚举走 GET 顺号探测（seq 稠密单调，读到 404
//! 即停，见 `sync_stream::pull_segments`），根本不发 PROPFIND——所以没有重蹈覆辙。

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::{Client, Method};

use crate::models::constants::{MD_CLOUD_CONNECT_SECS, MD_CLOUD_READ_SECS};

use super::{dir, fail_on_status, map_reqwest, WebdavError, WebdavTarget, USER_AGENT};

/// 写一份「只允许不存在」的文件。服务端回 412（Precondition Failed）表示目标已存在，
/// 返回 `Ok(false)` 而不是错误；其余语义与 `put` 相同（409 补建父目录后重试一次）。
pub async fn put_new(
    target: &WebdavTarget,
    rel: &str,
    bytes: &[u8],
) -> Result<bool, WebdavError> {
    match send_put_new(target, rel, bytes).await {
        /* 已存在 = 别人的分段已经占了这个名字。不覆盖：分段是只写一次的不可变文件。 */
        Err(WebdavError::Precondition) => Ok(false),
        Err(WebdavError::Server(409)) => match dir::ensure_base_dir_err(target).await? {
            dir::EnsureOutcome::Ready { .. } => send_put_new(target, rel, bytes).await.map(|_| true),
            dir::EnsureOutcome::TooDeep { levels } => {
                crate::log_warn!(
                    "md cloud mkcol: {} levels={levels} skip=too-deep",
                    target.base_path
                );
                Err(WebdavError::Server(409))
            }
        },
        Err(err) => Err(err),
        Ok(()) => Ok(true),
    }
}

/// 裸的 `If-None-Match: *` PUT，不补建目录（409 原样上抛，交给 [`put_new`] 兜底）。
async fn send_put_new(
    target: &WebdavTarget,
    rel: &str,
    bytes: &[u8],
) -> Result<(), WebdavError> {
    let url = target.url_for(rel)?;
    let response = super::client()?
        .put(&url)
        .basic_auth(&target.user, Some(&target.password))
        .header(reqwest::header::IF_NONE_MATCH, "*")
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(map_reqwest)?;
    fail_on_status(response.status())
}

/// 列 `rel` 目录下的**直接子项名**（不含父路径、去尾斜杠、已百分号解码）。
///
/// 只对 `sync/events/` 这类「数量 = 设备数」的小目录发；分段文件枚举请用 GET 顺号探测。
pub async fn list_children(target: &WebdavTarget, rel: &str) -> Result<Vec<String>, WebdavError> {
    let url = target.url_for(rel)?;
    /* depth-1 只回集合本身 + 一层子项；resourcetype 只为让服务端肯回 multistatus。 */
    let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#;
    let response = propfind_client()?
        .request(propfind_method(), &url)
        .basic_auth(&target.user, Some(&target.password))
        .header(depth_header(), HeaderValue::from_static("1"))
        .header(reqwest::header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(body.to_string())
        .send()
        .await
        .map_err(map_reqwest)?;
    fail_on_status(response.status())?;
    let text = response.text().await.map_err(map_reqwest)?;
    Ok(children_of(&text, rel))
}

/// 从 multistatus XML 里抽出 `rel` 的直接子项名。
///
/// WebDAV 的 href 命名空间前缀不定（`<D:href>` / `<d:href>` / 裸 `<href>`），所以不引
/// XML 解析器（也不新增 crate），按「`href>` 开标签结尾 → 下一个 `</`」切段，再百分号
/// 解码、取末段、去尾斜杠。depth-1 的响应必然包含集合自身，这里把与 `rel` 同名的末段
/// 滤掉，剩下的就是直接子项。
fn children_of(xml: &str, rel: &str) -> Vec<String> {
    let self_name = rel.trim_matches('/').rsplit('/').next().unwrap_or("");
    let mut names: Vec<String> = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("href>") {
        let after_tag = &rest[start + "href>".len()..];
        let Some(end) = after_tag.find("</") else { break };
        let raw = &after_tag[..end];
        rest = &after_tag[end..];

        let decoded = percent_decode(raw);
        let decoded = decoded.trim_end_matches('/');
        let Some(name) = decoded.rsplit('/').next() else {
            continue;
        };
        if name.is_empty() || name == self_name {
            continue;
        }
        if !names.iter().any(|existing| existing == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// RFC 3986 百分号解码（`encode_rel` 的反向）。非法转义按字面量保留，不 panic。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Ok(hi), Ok(lo)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Result<u8, ()> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(()),
    }
}

/// PROPFIND 专用 Client：禁止跟随重定向（与 MKCOL 同口径，见 `dir.rs` 模块头）。
fn propfind_client() -> Result<&'static Client, WebdavError> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            super::tls::builder()?
                .connect_timeout(Duration::from_secs(MD_CLOUD_CONNECT_SECS))
                .timeout(Duration::from_secs(MD_CLOUD_READ_SECS))
                .user_agent(USER_AGENT)
                .redirect(Policy::none())
                .build()
                .map_err(|err| format!("建不出 HTTP 客户端：{err}"))
        })
        .as_ref()
        .map_err(|err| WebdavError::Network(err.clone()))
}

fn propfind_method() -> Method {
    static METHOD: OnceLock<Method> = OnceLock::new();
    METHOD
        .get_or_init(|| Method::from_bytes(b"PROPFIND").expect("PROPFIND 是合法的 HTTP 方法名"))
        .clone()
}

fn depth_header() -> HeaderName {
    HeaderName::from_static("Depth")
}

#[cfg(test)]
mod tests {
    use super::{children_of, percent_decode};

    #[test]
    fn decodes_percent_encoded_hrefs() {
        assert_eq!(percent_decode("sync/events/abc%31%32%33/"), "sync/events/abc123/");
        assert_eq!(percent_decode("no-escapes"), "no-escapes");
        assert_eq!(percent_decode("%zz"), "%zz", "非法转义按字面量保留");
    }

    #[test]
    fn extracts_direct_children_and_drops_the_collection_itself() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/base/sync/events/</d:href></d:response>
  <d:response><d:href>/base/sync/events/aaaaaaaaaaaa/</d:href></d:response>
  <d:response><d:href>/base/sync/events/bbbbbbbbbbbb</d:href></d:response>
</d:multistatus>"#;
        let names = children_of(xml, "sync/events/");
        assert_eq!(names, vec!["aaaaaaaaaaaa".to_string(), "bbbbbbbbbbbb".to_string()]);
    }
}
