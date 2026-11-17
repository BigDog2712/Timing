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
            dir::EnsureOutcome::Ready { .. } => {
                /* 409 = 父集合不存在。`ensure_base_dir` 只补到 `basePath` 那几级，而分段的
                   落点还在 `sync/events/<设备 id>/` 下面 —— 那几级它不认识，从来没人建过，
                   于是重试一次还是同一个 409，手机首次上传**恒失败**（0.12.12 真机实测，
                   远端始终只有桌面那一个设备目录）。先把 `rel` 的父目录逐级建出来再重试。 */
                ensure_parent_dirs(target, rel).await?;
                send_put_new(target, rel, bytes).await.map(|_| true)
            }
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

/// 把 `rel` 的父目录**逐级**建出来（浅 → 深）。PUT 收 409 之后才调。
///
/// 「逐级」不能省：坚果云对「父集合不存在」的 MKCOL 也回 409，跳级建等于白建。
/// 已存在的级别 `mkcol_url` 判 405/3xx 当「已存在」，所以整条链是幂等的。
async fn ensure_parent_dirs(target: &WebdavTarget, rel: &str) -> Result<(), WebdavError> {
    for prefix in parent_prefixes(rel) {
        let url = target.url_for(&format!("{prefix}/"))?;
        dir::mkcol_url(target, &url, &prefix).await?;
    }
    Ok(())
}

/// `rel` 的父目录各「逐级前缀」：`"sync/events/abc/1.jsonl"` → `["sync", "sync/events",
/// "sync/events/abc"]`。
///
/// 纯函数（不拼 URL、不发请求），所以能单测 —— 这是本文件里唯一不依赖服务端的判据面。
/// 没有 `/` 的 `rel`（直接落在 base 下）返回空：那说明父目录就是 base，已经在
/// `ensure_base_dir` 里建过了。
fn parent_prefixes(rel: &str) -> Vec<String> {
    let rel = rel.trim().trim_matches('/');
    let Some((dir, _file)) = rel.rsplit_once('/') else {
        return Vec::new();
    };
    let mut prefixes: Vec<String> = Vec::new();
    let mut current = String::new();
    for segment in dir.split('/').filter(|segment| !segment.is_empty()) {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(segment);
        prefixes.push(current.clone());
    }
    prefixes
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
    const MAX_DIRECTORY_BYTES: usize = 2 * 1024 * 1024;
    super::limits::check_content_length(&response, MAX_DIRECTORY_BYTES)?;
    let bytes = super::limits::read_limited(response, MAX_DIRECTORY_BYTES).await?;
    let text = String::from_utf8(bytes).map_err(|_| WebdavError::Network("WebDAV 目录响应不是 UTF-8".into()))?;
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

/// `Depth: 1` 的头名，**必须全小写**。
///
/// `http` crate 的 `HeaderName::from_static` 只收小写字面量（它把名字当 `'static`
/// 做 H2 风格的静态优化），传大写会在**运行期** panic 而不是编译期报错，报
/// `HeaderName::from_static with invalid bytes`。线上后果实测过：Android 侧
/// `panic = "abort"`，这个 panic 落在 `tokio-rt-worker` 上 ⇒ 整进程 SIGABRT，
/// 表现为「一同步就闪退」（0.12.9 真机 tombstone，2026-11-16 21:45:50）。
///
/// HTTP 头名本身大小写不敏感，发 `depth` 与 `Depth` 语义完全一致；`mod.rs` 那侧用
/// `.header("Depth", ..)` 字符串形式是安全的（走 `from_bytes`，内部会小写化），
/// 只有 `from_static` 这条快路径有这个陷阱。
fn depth_header() -> HeaderName {
    HeaderName::from_static("depth")
}

#[cfg(test)]
mod tests {
    use super::{children_of, percent_decode};

    /// 0.12.9 真机闪退的回归判据。
    ///
    /// `HeaderName::from_static` 只收小写：写回 `"Depth"` 时本用例会在**调用那一刻**
    /// panic（不是断言失败），Android `panic = "abort"` 下就是整进程 SIGABRT。
    /// 断言的是**精确字面量**而不只是「没 panic」——头名大小写不敏感，落小写不损语义，
    /// 但一旦有人改回大写，这里必须立刻红。
    #[test]
    fn parent_prefixes_walks_every_level_below_base() {
        assert_eq!(
            super::parent_prefixes("sync/events/b265fafdc306/00000007.jsonl"),
            vec![
                "sync".to_string(),
                "sync/events".to_string(),
                "sync/events/b265fafdc306".to_string()
            ],
            "409 补建要按浅→深逐级来，跳级建会被服务端同样回 409"
        );
        assert!(
            super::parent_prefixes("00000001.jsonl").is_empty(),
            "直接落在 base 下时父目录就是 base，不该再建"
        );
    }

    #[test]
    fn depth_header_name_stays_lowercase() {
        assert_eq!(super::depth_header().as_str(), "depth");
    }

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
