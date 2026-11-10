//! [QA G2] `level_path` 从 `dir.rs` 搬到 `tag.rs` 之后，「卡在第几级」这件事实不许变。
//!
//! 为什么单开这一条：`tests/md_webdav_text.rs` 里那条 E4 用例把 `FailStage::Dir { level }`
//! 的层级**字面量**写死了（`"/我的坚果云/Timing"`），`level_path` 就算返回空串它照样绿——
//! 它证明的是「文案会读这个字段」，不是「这个字段里填的是对的那一级」。
//! 这里的断言落在 `DirFailure.level` 上，而它**唯一**的来源就是 `tag::level_path`：
//! 函数搬走、签名从私有变 `pub(crate)`，行为必须逐字符不变。
//!
//! 三条用例各自钉一个分支：正常失败（第 N 级）、已有一级（`ready` 计数）、`..` 拒绝
//! （`level_path(total)` 取全路径且一个请求都不发）。

use crate::infra::md_webdav::dir::ensure_base_dir;
use crate::infra::md_webdav::{WebdavError, WebdavTarget};
use super::fake_webdav_dir::DirServer;

fn target(server: &DirServer, base_path: &str) -> WebdavTarget {
    WebdavTarget::new(&server.base_url, base_path, "u", "p")
}

/// 第 2 级建不出来 → `level` 说的是**那一级**，不是整条 `base_path`。
///
/// 如果 `level_path` 改成返回 `base_path` 全文，这里会得到 `/Timing/md` 之外的东西；
/// 改成返回空串则直接红。日志里的 `level=` 就是靠它定位的。
#[tokio::test]
async fn failure_level_names_the_level_that_failed() {
    let server = DirServer::new(&[]);
    server.fail_mkcol_at("/Timing/md", 400);

    let failure = ensure_base_dir(&target(&server, "/Timing/md"))
        .await
        .expect_err("第 2 级 400，补建必须失败");
    assert_eq!(failure.level, "/Timing/md", "level 是浅→深拼出来的相对路径");
    assert_eq!(failure.ready, 1, "第 1 级已建成 → ready = 1");
    assert_eq!(
        failure.error,
        WebdavError::Server(400),
        "原错误不许被包装或改写成别的变体"
    );
}

/// 中文目录：`level_path` 用 `dir_levels()` 的**原文**段拼接，不编码、不解码。
///
/// 一旦有人在这里加了 `urlencoding`，日志里会出现 `/我的坚果云` 变成 `/%E6%88%91…`，
/// 而用户拿这条日志去对照设置页会找不到那个目录。
#[tokio::test]
async fn failure_level_keeps_chinese_segments_as_is() {
    let server = DirServer::new(&["/我的坚果云"]);
    server.fail_mkcol_at("/我的坚果云/Timing", 409);

    let failure = ensure_base_dir(&target(&server, "/我的坚果云/Timing"))
        .await
        .expect_err("第 2 级 409，补建必须失败");
    assert_eq!(failure.level, "/我的坚果云/Timing");
    assert_eq!(failure.ready, 1, "第 1 级本来就存在 → 也算就绪");
    assert!(
        !failure.level.contains('%'),
        "日志里的层级不许是百分号编码：{}",
        failure.level
    );
    assert_eq!(failure.error, WebdavError::Server(409));
}

/// `..` 的拒绝先于任何请求：`level` 取 `level_path(total)` = 全路径。
///
/// 这一条同时是「搬文件没搬出副作用」的证据：`ensure_base_dir` 里对 `level_path` 的
/// 另一处调用（`total` 而不是 `level`）仍在生效。
#[tokio::test]
async fn dotdot_rejects_before_any_request_and_reports_the_whole_path() {
    let server = DirServer::new(&[]);
    let failure = ensure_base_dir(&target(&server, "/a/../b"))
        .await
        .expect_err("含 `..` 的远端目录必须拒");

    assert_eq!(failure.level, "/a/../b", "越界信息取全路径");
    assert_eq!(failure.ready, 0, "一个都没建");
    assert!(
        matches!(&failure.error, WebdavError::Network(msg) if msg.contains("..")),
        "错误类型必须是 Network 且说清原因：{:?}",
        failure.error
    );
    assert!(
        server.method_paths().is_empty(),
        "检查必须先于任何请求，实际发了：{:?}",
        server.method_paths()
    );
}
