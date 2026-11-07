//! 云端通道的**文案表**（V0.11.16，设计 §4.3）：远端错误 → 给用户看的一句话。
//!
//! 从 `round_push.rs` 整段搬出来（那边 226 行，且「测试连接」的三关也要用同一张表：
//! 一张表两处复制，403 迟早出现两套解释）。`round_push.rs` 留了
//! `pub(crate) use`，既有 3 个调用点与测试**一字不用改**。
//!
//! ## 两条口径（改句子之前先看）
//!
//! 1. **状态码只进日志**：这里任何一句都不许出现裸状态码（`\b\d{3}\b` 零命中），
//!    由 `tests/md_webdav_text.rs::no_bare_status_code_in_any_fail_text` 机器断言；
//!    状态码经 `fail_tag` 进日志（`fail=Forbidden`），排障看日志。
//! 2. **403 分两句**：`Forbidden` 只说「卡在哪一关」那一件事，并给**一个**动作。
//!    v0.11.15 那句「账号能登录，但没有写文件的权限。请确认…或…或…」把三种可能并列，
//!    用户读完仍然不知道该动哪一个，而且其中两种是错的（可能是目录建不出来）。

use crate::infra::md_webdav::WebdavError;

/// 远端错误 → 日志里的分类词（`md cloud out: <date>.md fail=<这个>`）。
///
/// 与 `infra::md_webdav::dir::fail_tag` 是同一套词表（排障 grep 的契约）：`services`
/// 可以依赖 `infra`，但两个模块各自持有一份是为了「日志词表不跨层传递」。
pub(crate) fn fail_tag(err: &WebdavError) -> &'static str {
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

/// 远端路径的展示形态（设计 §8-1：**唯一出口**，别处不许自己拼引号）。
///
/// 空串 = 服务地址根目录：直接显示 `「」` 会让用户以为路径丢了。
pub(crate) fn dir_label(dir: &str) -> String {
    let dir = dir.trim();
    if dir.is_empty() {
        "（服务地址根目录）".to_string()
    } else {
        format!("「{dir}」")
    }
}

/// 失败发生在哪一关。**只影响 `Forbidden` 与 `Server(400)` 两句的措辞**，其余变体一律
/// 走同一句（同一个状态码出现两套解释，用户只会更糊涂）。
pub(crate) enum FailStage<'a> {
    /// 自动同步 / 补传：目录已于 `put` 内建 409 补建，所以 403 的主因是「写不进去」
    Push,
    /// 测试连接 第 1 关：GET 服务地址
    Account,
    /// 测试连接 第 2 关：MKCOL 某一级
    Dir { level: &'a str, ready: usize },
    /// 测试连接 第 3 关：PUT 探针
    Write,
}

/// 远端错误 → 一句话。`remote_dir` 是**规范化后的** `target.base_path`（形如 `/Timing/md`）：
/// 文案里要带出真实路径，用户才知道该去网盘网页版建哪个目录。空串交给 `dir_label`。
///
/// 旧签名保留（== `fail_text_at(FailStage::Push, …)`）：自动同步路径的 403 从来不是
/// 「目录建不出来」，那边一个字的语义都没变。
pub(crate) fn fail_text(err: &WebdavError, remote_dir: &str) -> String {
    fail_text_at(FailStage::Push, err, remote_dir)
}

/// **唯一出口**：按关卡取措辞。
pub(crate) fn fail_text_at(stage: FailStage<'_>, err: &WebdavError, remote_dir: &str) -> String {
    let label = dir_label(remote_dir);
    match err {
        WebdavError::Auth => {
            "账号或应用密码不对（坚果云要用应用密码，在网页版 → 账户信息 → 安全选项里添加）".into()
        }
        WebdavError::Forbidden => forbidden_text(stage, &label, remote_dir),
        WebdavError::RateLimited => "坚果云限流了，稍后会自动重试".into(),
        WebdavError::Precondition => "远端这份在你上传前被改过，本轮没有覆盖".into(),
        WebdavError::NotFound => format!("远端目录{label}还不存在：请先在坚果云网页版建好目录"),
        WebdavError::Timeout => "连接超时，稍后会自动重试".into(),
        WebdavError::Network(message) => format!("连不上 WebDAV：{message}"),
        /* 409 = 父集合不存在且服务端不让程序建。这是唯一一条用户**当场能自己解决**的
        远端错误，所以要说清「去哪、按什么路径、建几级」。 */
        WebdavError::Server(409) => format!(
            "云端目录{label}还不存在，这台服务器不允许程序自动建。\
             请到网盘网页版按这个路径手动建好目录（含每一级），再点「测试连接」。"
        ),
        /* 400 = 服务端不接受这个名字。字符集是最常见的成因，直接给可照做的规则。 */
        WebdavError::Server(400) => bad_chars_text(stage, &label, remote_dir),
        /* 5xx 是**真的会退避重试**，这句话对用户有用（主理人裁决：保句子、去数字）。 */
        WebdavError::Server(code) if (500..600).contains(code) => {
            "WebDAV 服务暂时出错，稍后会自动重试；\
             如果一直这样，请把日志里带 md cloud out 的那几行发给开发者。"
                .into()
        }
        /* 兜底（其余 4xx、423 Locked 等）：状态码对用户零信息量，只进日志。 */
        WebdavError::Server(_) => {
            "WebDAV 服务拒绝了这次写入，没有给出可读的原因。\
             请把日志里带 md cloud out 的那几行发给开发者。"
                .into()
        }
    }
}

/// `403` 的四句（PRD 6.3 的文案表，R9 的全部内容）。
///
/// 「只读 vs 配额满」服务端不给理由，程序也分不出来——所以把判断交给**一次用户可以
/// 自己做的对照实验**（往那个文件夹里拖一个文件）。这是唯一诚实的做法。
fn forbidden_text(stage: FailStage<'_>, label: &str, dir: &str) -> String {
    match stage {
        FailStage::Account => format!(
            "账号能登录，但{label}这一层不允许访问：请确认地址与账号属于同一台服务端。{}",
            non_ascii_hint(dir)
        ),
        FailStage::Dir { level, ready: 0 } => format!(
            "云端目录{label}的第一级「{level}」建不出来：这个位置不允许程序新建文件夹。\
             请到坚果云网页版 → 我的坚果云 → 新建文件夹，名字用「{last}」，再点「测试连接」。{}",
            non_ascii_hint(dir),
            last = last_segment(level)
        ),
        FailStage::Dir { level, ready } => format!(
            "「{parent}」已就绪，但「{level}」这一级建不出来：这个位置不允许程序新建文件夹。\
             请到坚果云网页版 → 我的坚果云 → 新建文件夹，名字用「{last}」，再点「测试连接」。{}",
            non_ascii_hint(dir),
            parent = parent_path(level, ready),
            last = last_segment(level)
        ),
        FailStage::Push | FailStage::Write => format!(
            "文件夹已就绪，但写不进去文件。两种可能：在坚果云网页版往{label}里拖一个文件——\
             拖得进去 = 本月上传量用完了，等月初；拖不进去 = 这个文件夹是只读的，换个文件夹。{}",
            non_ascii_hint(dir)
        ),
    }
}

/// `400`：`Dir` 关卡带出卡住的那一级（那才是用户要改的名字），其余关卡沿用旧句。
fn bad_chars_text(stage: FailStage<'_>, label: &str, dir: &str) -> String {
    match stage {
        FailStage::Dir { level, .. } => format!(
            "远端目录「{level}」里有服务端不接受的字符。\
             请把目录名改成只用字母、数字、- 和 _，不要用 ? # % 空格，也不要留全角斜杠。{}",
            non_ascii_hint(dir)
        ),
        _ => format!(
            "远端目录{label}里有服务端不接受的字符。\
             请把目录名改成只用字母、数字、- 和 _，不要用 ? # % 空格，也不要留全角斜杠。"
        ),
    }
}

/// R13 退路：路径含非 ASCII 且失败与「名字」有关时，追加一句**可执行**退路。
///
/// 中文路径能不能通取决于服务端（本项目无法在发版前联网验完所有服务端），所以给一条
/// 一分钟能试完的退路，而不是让用户对着红字猜。
fn non_ascii_hint(path: &str) -> &'static str {
    if path.is_ascii() {
        ""
    } else {
        "目录名里有中文时，也可以先把目录改成英文再试一次（例如 /Timing）。"
    }
}

/// `/我的坚果云/Timing` → `Timing`（“新建文件夹”时用户要打的就是这一段）
fn last_segment(level: &str) -> &str {
    level.rsplit('/').find(|segment| !segment.is_empty()).unwrap_or(level)
}

/// `parent_path("/我的坚果云/Timing", 1)` → `/我的坚果云`（与 `dir::level_path` 同源）
fn parent_path(level: &str, ready: usize) -> String {
    let segments: Vec<&str> = level.split('/').filter(|segment| !segment.is_empty()).collect();
    let up_to = ready.min(segments.len());
    format!("/{}", segments[..up_to].join("/"))
}
