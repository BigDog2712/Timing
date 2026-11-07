//! 日志词表：远端错误 → 分类型词，以及「卡在第几级」的路径形态（V0.11.16）。
//!
//! 从 `dir.rs` 整段搬出来（[QA G2]）：那边 298 行、只剩 2 行余量，下一轮任何改动都会撞
//! 300 行门禁。搬的是**纯函数**——不读 state、不碰网络、不建 Client，所以它们的单测也
//! 不需要假服务器（`tests/md_webdav_dir.rs` 那边的预算全留给 MKCOL 的因果链）。
//!
//! ## 为什么这里有一份 `fail_tag`，`services/md_cloud/text.rs` 还有一份
//!
//! `infra` 不许依赖 `services`（L4），而 MKCOL 的日志与「同步一轮」的日志必须说同一套词
//! （排障时 `grep fail=` 一条命令要能捞全）。两份**逐变体一致**由
//! `tests/md_webdav_text.rs::log_vocabulary_agrees_and_carries_status_code` 机测，
//! 不再只靠注释的自称。
//!
//! ## 口径：状态码只进日志
//!
//! 这两件产物都只出现在日志行里（`md cloud mkcol: … fail=Server(409)`）。用户可见文案由
//! `services/md_cloud/text.rs` 负责，那里 `\b\d{3}\b` 零命中（PRD 5.2 口径 2）。

use std::borrow::Cow;

use super::{WebdavError, WebdavTarget};

/// 第 `level` 级的相对路径（只给日志用：`/我的坚果云/Timing` 这种形态，与 `base_path` 同源）。
///
/// 越界的 `level`（大于实际级数）夹到末级：日志里出现一个不存在的层级比少一级更难读。
pub(crate) fn level_path(target: &WebdavTarget, level: usize) -> String {
    let levels = target.dir_levels();
    format!("/{}", levels[..level.min(levels.len())].join("/"))
}

/// 日志里的分类型词（`fail=Auth` / `fail=Server(409)`）。
///
/// [V0.11.16 F5] `Server` **带状态码**：`Server(400)`（远端目录名里有服务端不接受的字符
/// → 改名字）与 `Server(503)`（服务端自己出错 → 等一等自动重试）处置完全相反，丢掉码就
/// 只能靠猜。非 `Server` 变体沿用 v0.11.13 起的旧词，已有日志靠它 grep。
pub(crate) fn fail_tag(err: &WebdavError) -> Cow<'static, str> {
    match err {
        WebdavError::Auth => Cow::Borrowed("Auth"),
        WebdavError::Forbidden => Cow::Borrowed("Forbidden"),
        WebdavError::RateLimited => Cow::Borrowed("RateLimited"),
        WebdavError::Precondition => Cow::Borrowed("Precondition"),
        WebdavError::NotFound => Cow::Borrowed("NotFound"),
        WebdavError::Timeout => Cow::Borrowed("Timeout"),
        WebdavError::Network(_) => Cow::Borrowed("Network"),
        /* 表外 4xx / 5xx：码本身就是唯一能分诊的信息，别丢 */
        WebdavError::Server(code) => Cow::Owned(format!("Server({code})")),
    }
}

#[cfg(test)]
mod tests {
    use super::{fail_tag, level_path};
    use crate::infra::md_webdav::{WebdavError, WebdavTarget};

    fn target(path: &str) -> WebdavTarget {
        WebdavTarget::new("https://dav.example.com/dav/", path, "me@example.com", "app-pass")
    }

    #[test]
    fn level_path_is_a_slash_prefix_of_base_path() {
        let item = target("/我的坚果云/Timing");
        assert_eq!(level_path(&item, 1), "/我的坚果云");
        assert_eq!(level_path(&item, 2), "/我的坚果云/Timing");
        /* 越界夹到末级：日志里不许出现一个不存在的层级 */
        assert_eq!(level_path(&item, 9), "/我的坚果云/Timing");
        /* 空 base_path = 0 级：根目录的路径就是 `/`（不是空串，读起来才知道是根） */
        assert_eq!(level_path(&target(""), 1), "/");
        assert_eq!(level_path(&target("/"), 1), "/");
    }

    #[test]
    fn fail_tag_carries_the_status_code_for_server_errors() {
        for code in [400u16, 409, 423, 500, 503] {
            let tag = fail_tag(&WebdavError::Server(code)).to_string();
            assert_eq!(tag, format!("Server({code})"));
            /* 退化回裸 `Server` 就分不清「改名字」与「等一等」 */
            assert_ne!(tag, "Server");
        }
    }

    #[test]
    fn fail_tag_keeps_the_old_words_for_named_variants() {
        let cases = [
            (WebdavError::Auth, "Auth"),
            (WebdavError::Forbidden, "Forbidden"),
            (WebdavError::RateLimited, "RateLimited"),
            (WebdavError::Precondition, "Precondition"),
            (WebdavError::NotFound, "NotFound"),
            (WebdavError::Timeout, "Timeout"),
            (WebdavError::Network("连不上".into()), "Network"),
        ];
        for (err, expect) in cases {
            assert_eq!(fail_tag(&err), expect, "旧词不许顺手改名（已有日志靠它 grep）");
            /* 词表是给 `fail={}` 用的：不许有空格、不许是空串 */
            assert!(!expect.is_empty() && !expect.contains(' '));
        }
    }
}
