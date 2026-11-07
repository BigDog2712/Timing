//! 对**目录**发请求的那一半：`probe`（判地址与凭据）与 MKCOL（按需建目录）。
//!
//! 从 `mod.rs` 拆出来不是为了凑行数：`probe` 与 MKCOL 是同一类动作（对目录而不是对
//! `{date}.md` 发请求），判定表也共用一张——`200 / 404 / 405 / 3xx` 各自什么意思在这里
//! 定义一次，`mod.rs` 那边只关心「一份文件写没写上去」。
//!
//! ## 逐级建目录的算法（设计 §2.3）
//!
//! ```text
//! levels = dir_levels()                 // ["Timing","md"]；空 → 0 级
//! 含 .. → Err（一个请求都不发）
//! len > 8 → TooDeep{len}                // 一个请求都不发
//! for level in 1..=len:                 // 浅 → 深，顺序不可换
//!     mkcol(level): Created → created += 1 / Exists → 不计
//! Ready{created, levels}
//! ```
//!
//! **幂等**：`Exists` 不报错、不重试、不删除。对同一目标重复调用等价（第二次 `created = 0`）。
//!
//! ## 红线：失败不回滚、不删远端任何东西
//!
//! 已经建出来的上级目录**保留**，即使后面某一级失败（409 立刻停，已在的那几级留着）。
//! 远端 `DELETE` 是不可撤销的破坏性动作：为了「干净」去删用户网盘里的目录，风险远大于
//! 留下一个空目录——而且那个空目录正是下一轮成功所需。
//!
//! ## 为什么 MKCOL 要单独一个 Client
//!
//! reqwest 对 301/302/303 会把请求方法**改成 GET**（它按浏览器语义处理）。不禁止跟随，
//! 一次「要求补尾斜杠」的 MKCOL 就会变成 `GET <dir>`，返回 200/404 之后我们既不知道
//! 到底建没建，日志也全是假的。所以 MKCOL 走 `mkcol_client()`（`redirect(none)`）：
//! 3xx 一律当「已存在」，这是本轮唯一说得清的判据。

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::redirect::Policy;
use reqwest::{Client, Method};

use crate::models::constants::{MD_CLOUD_CONNECT_SECS, MD_CLOUD_READ_SECS};

/* `probe` 复用的 GET、状态码归一化、TLS 初始化用的 UA 都在 `mod.rs`：两条路径的
「什么算成功」必须只有一处判据。 */
use super::{fail_on_status, map_reqwest, WebdavError, WebdavTarget, USER_AGENT};

/// 最多自动建几级目录。9 级以上的 `basePath` 几乎只可能是拼错的地址：发 20 次 MKCOL
/// 既慢又像在攻击服务端。判定是纯函数，可单测（`hits().len() == 1`，只剩那次 409 的 PUT）。
pub const MAX_LEVELS: usize = 8;

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

/// 一次补建的结果。`TooDeep` 不是错误：由**调用方**决定怎么说（`put` 里降级成
/// `Server(409)`；「测试连接」里说人话），语气的分叉不该埋在传输层。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnsureOutcome {
    Ready { created: usize, levels: usize },
    TooDeep { levels: usize },
}

impl WebdavTarget {
    /// `base_path` 的段（空 → 空 vec）。`/` 与空串都得到 0 级。
    pub fn dir_levels(&self) -> Vec<&str> {
        self.base_path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect()
    }

    /// 第 `level` 级的 URL（1 起）。与 `url_for` 共用 `validated_base()`，**原样拼接
    /// `base_path` 的前 `level` 段**、不做百分号编码（设计 §2.2）：`url_for` 对
    /// `base_path` 也是原样拼接，两条路径必须得到逐字符相同的 URL。
    pub fn dir_url(&self, level: usize) -> Result<String, WebdavError> {
        let base = self.validated_base()?;
        let levels = self.dir_levels();
        if level == 0 || level > levels.len() {
            return Err(WebdavError::Network(format!("远端目录级数越界：{level}")));
        }
        let mut url = String::with_capacity(base.len() + self.base_path.len());
        url.push_str(base);
        for segment in &levels[..level] {
            url.push('/');
            url.push_str(segment);
        }
        Ok(url)
    }
}

/// 「这个地址和凭证能不能用」。判据分三档（见 `ProbeOutcome`）：200 / 404 算通，
/// 405 与 3xx 算「通但读不了目录」，其余仍是错误。
///
/// 同步本身 GET 的是 `{date}.md` 这个具体文件，不是目录，所以「读不了目录」不影响
/// 这条通道能不能用。注意它**不**证明「能写」——那要 `ensure_base_dir` 说了算
/// （「测试连接」两件事都做，见 `services/md_cloud/probe.rs`）。
pub async fn probe(target: &WebdavTarget, rel: &str) -> Result<ProbeOutcome, WebdavError> {
    match super::get(target, rel).await {
        Ok(_) => Ok(ProbeOutcome::Reachable),
        Err(WebdavError::NotFound) => Ok(ProbeOutcome::Reachable),
        /* 405 = 服务端不认「GET 一个目录」这个方法；3xx = 要跳转（301 补尾斜杠是最常见
        的一种）。两者都发生在**鉴权通过之后**，所以绝不是「凭据不对」。 */
        Err(WebdavError::Server(code)) if matches!(code, 405 | 300..=399) => {
            Ok(ProbeOutcome::NoDirectoryListing(code))
        }
        Err(err) => Err(err),
    }
}

/// 按需把 `base_path` 逐级建出来。调用方只在「PUT 409」与「测试连接」两处用它。
pub async fn ensure_base_dir(target: &WebdavTarget) -> Result<EnsureOutcome, WebdavError> {
    let levels = target.dir_levels();
    let total = levels.len();
    if total == 0 {
        /* 根目录永远存在：一个请求都不发。 */
        return Ok(EnsureOutcome::Ready {
            created: 0,
            levels: 0,
        });
    }
    /* `..` 检查**先于任何请求**：服务端会把它规范化掉，于是 MKCOL 会建到用户没填的
    层级上去；`url_for` 在文件路径上同样拒（设计 §2.2 最后一行）。 */
    if levels.contains(&"..") {
        return Err(WebdavError::Network("远端目录不能包含 ..".into()));
    }
    if total > MAX_LEVELS {
        return Ok(EnsureOutcome::TooDeep { levels: total });
    }
    let mut created = 0usize;
    /* 浅 → 深，顺序不可换：每一级的父级必须先存在，否则必然 409。 */
    for level in 1..=total {
        if mkcol(target, level).await? {
            created += 1;
        }
    }
    crate::log_info!(
        "md cloud mkcol: {} levels={} created={}",
        target.base_path,
        total,
        created
    );
    Ok(EnsureOutcome::Ready {
        created,
        levels: total,
    })
}

/// 建一级目录。`Ok(true)` = 建成了，`Ok(false)` = 已经存在（幂等）。
async fn mkcol(target: &WebdavTarget, level: usize) -> Result<bool, WebdavError> {
    let url = target.dir_url(level)?;
    let response = mkcol_client()
        .request(mkcol_method(), &url)
        .basic_auth(&target.user, Some(&target.password))
        /* 空 body，且**显式**写 `Content-Length: 0`：部分服务端要求 MKCOL 带一个长度 0
        的实体；而 reqwest 对非 PUT/POST 方法不会自己补这个头（实测就是不发）。 */
        .header(reqwest::header::CONTENT_LENGTH, 0)
        .body(Vec::<u8>::new())
        .send()
        .await
        .map_err(map_reqwest)?;
    let status = response.status();
    let code = status.as_u16();
    if status.is_success() {
        /* 201 是 RFC 说的 Created；200 / 204 是少数实现不严格。都当建成。 */
        return Ok(true);
    }
    /* 405 = Method Not Allowed：RFC 4918 里它的含义就是「集合已存在」。 */
    if code == 405 {
        crate::log_debug!(
            "md cloud mkcol: {} status=405 assume=existing",
            level_path(target, level)
        );
        return Ok(false);
    }
    /* 3xx：要求补尾斜杠 / 已改名。**不跟随**（见模块头的 Client 说明），当已存在。 */
    if (300..400).contains(&code) {
        crate::log_info!(
            "md cloud mkcol: {} status={code} assume=existing",
            level_path(target, level)
        );
        return Ok(false);
    }
    /* 其余一律停：401 Auth / 403 Forbidden / 409 Server(409) / 400 / 423 / 5xx。
    `?` 由调用方上抛，**不删除**已经建出来的上级目录（模块头的红线）。 */
    match fail_on_status(status) {
        Ok(()) => Ok(true),
        Err(err) => {
            crate::log_warn!(
                "md cloud mkcol: {} fail={}",
                level_path(target, level),
                fail_tag(&err)
            );
            Err(err)
        }
    }
}

/// 第 `level` 级的相对路径（只给日志用：`/Timing/md` 这种形态，与 `base_path` 同源）。
fn level_path(target: &WebdavTarget, level: usize) -> String {
    let levels = target.dir_levels();
    format!("/{}", levels[..level.min(levels.len())].join("/"))
}

/// MKCOL 专用 Client：**禁止跟随重定向**（理由见模块头）。
///
/// 不共用 `mod.rs` 的 `client()`：GET / PUT 的 3xx 语义与 MKCOL 不同（`probe` 要把
/// 3xx 当「通但读不了目录」，那依赖 reqwest 的默认跟随把带 `Location` 的响应走完），
/// 共用一份会让两边互相拖累。
fn mkcol_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        /* 与 `mod.rs::client()` 同一段理由：`rustls-no-provider` 必须自己装加密提供者。
        重复安装只会在第二次返回 Err，忽略即可。 */
        let _ = rustls::crypto::ring::default_provider().install_default();
        Client::builder()
            .connect_timeout(Duration::from_secs(MD_CLOUD_CONNECT_SECS))
            .timeout(Duration::from_secs(MD_CLOUD_READ_SECS))
            .user_agent(USER_AGENT)
            .redirect(Policy::none())
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

fn mkcol_method() -> Method {
    static METHOD: OnceLock<Method> = OnceLock::new();
    METHOD
        .get_or_init(|| Method::from_bytes(b"MKCOL").expect("MKCOL 是合法的 HTTP 方法名"))
        .clone()
}

/// 日志里的分类型词。**与 `services::md_cloud::round_push::fail_tag` 是同一套词表**
/// （排障 grep 的契约）：`infra` 不许依赖 `services`（L4），所以这里只能有一份副本。
fn fail_tag(err: &WebdavError) -> &'static str {
    match err {
        WebdavError::Auth => "Auth",
        WebdavError::Forbidden => "Forbidden",
        WebdavError::RateLimited => "RateLimited",
        WebdavError::Precondition => "Precondition",
        WebdavError::NotFound => "NotFound",
        WebdavError::Timeout => "Timeout",
        WebdavError::Network(_) => "Network",
        WebdavError::Server(_) => "Server",
    }
}
