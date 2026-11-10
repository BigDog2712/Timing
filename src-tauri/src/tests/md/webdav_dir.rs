//! MKCOL 与 409 补建的判据（设计 §6.3）。九条用例 + 一条纯函数断言。
//!
//! 每条都能在「把 `put` 里的 409 补建分支注释掉」时变红——这是本轮唯一能证明
//! 「409 真的被修好了」的机器证据。假服务器是路由式的（`fake_webdav_dir.rs`），
//! 它的 `dirs` 是服务器的真实状态，不是预排的脚本。
//!
//! **不做**变异自检的替代品：注释掉分支后必须真的红（见交付说明里的前后输出）。

use crate::infra::md_webdav::dir::{ensure_base_dir, EnsureOutcome, MAX_LEVELS};
use crate::infra::md_webdav::{put, WebdavError, WebdavTarget};
use super::fake_webdav::header_value;
use super::fake_webdav_dir::DirServer;

fn target(server: &DirServer, base_path: &str) -> WebdavTarget {
    WebdavTarget::new(&server.base_url, base_path, "u", "p")
}

const REL: &str = "2026-11-07.md";

/// ① 核心：PUT 409 → 逐级建目录 → **只重试一次**。
#[tokio::test]
async fn put_409_bootstraps_base_path_and_retries_once() {
    let server = DirServer::new(&[]);
    let target = target(&server, "/Timing/md");
    let ok = put(&target, REL, b"# x", None).await.expect("补建后应成功");

    assert!(ok.etag.is_some(), "第二次 PUT 的 ETag 要带回来（下一轮 If-Match 用）");
    assert_eq!(
        server.method_paths(),
        vec![
            "PUT /Timing/md/2026-11-07.md",
            "MKCOL /Timing",
            "MKCOL /Timing/md",
            "PUT /Timing/md/2026-11-07.md",
        ],
        "顺序不可换：先 PUT，再浅 → 深建目录，最后重试一次"
    );
    /* MKCOL 必须是空 body：`Content-Length: 0` 是请求形状的一部分，被无意改掉
    （比如误用 `.body(bytes)`）时服务端会 400，而这条断言先红。 */
    let hits = server.hits();
    assert_eq!(
        header_value(&hits[1].raw, "content-length").as_deref(),
        Some("0"),
        "MKCOL 必须是不带实体的请求"
    );
}

/// ② `created` 的计数本身：两级都不存在 → 2。
#[tokio::test]
async fn ensure_base_dir_creates_each_level_and_is_idempotent() {
    let server = DirServer::new(&[]);
    let target = target(&server, "/Timing/md");

    let first = ensure_base_dir(&target).await.expect("应建成");
    assert_eq!(
        first,
        EnsureOutcome::Ready {
            created: 2,
            levels: 2
        }
    );
    assert_eq!(
        server.method_paths(),
        vec!["MKCOL /Timing", "MKCOL /Timing/md"],
        "浅 → 深，每级一次"
    );
    assert_eq!(server.dirs(), vec!["/Timing", "/Timing/md"], "服务端真的有了");

    /* 幂等：不去重的话「每轮同步都发 N 次 MKCOL」，8181 之类的服务端会开始限流。 */
    let again = ensure_base_dir(&target).await.expect("重复调用不该失败");
    assert_eq!(
        again,
        EnsureOutcome::Ready {
            created: 0,
            levels: 2
        },
        "第二次 created 必须是 0"
    );
}

/// ③ 405 = 集合已存在（RFC 4918）。不报错、不重试、不删除。
#[tokio::test]
async fn mkcol_405_counts_as_existing() {
    let server = DirServer::new(&["/Timing"]);
    let target = target(&server, "/Timing");

    let outcome = ensure_base_dir(&target).await.expect("405 是「已存在」，不是错误");
    assert_eq!(
        outcome,
        EnsureOutcome::Ready {
            created: 0,
            levels: 1
        }
    );
    assert_eq!(server.method_paths(), vec!["MKCOL /Timing"], "只发一次");
    put(&target, REL, b"# x", None)
        .await
        .expect("目录在，PUT 应成功");
}

/// ④ 301 视为已存在，且**绝不跟随**（跟随时 reqwest 会把 MKCOL 改成 GET）。
#[tokio::test]
async fn mkcol_301_counts_as_existing_without_following() {
    let server = DirServer::new(&[]);
    server.fail_mkcol_with(301);
    let target = target(&server, "/Timing/md");

    let outcome = ensure_base_dir(&target).await.expect("3xx 是「已就绪」，不是错误");
    assert_eq!(
        outcome,
        EnsureOutcome::Ready {
            created: 0,
            levels: 2
        }
    );
    assert_eq!(
        server.method_paths(),
        vec!["MKCOL /Timing", "MKCOL /Timing/md"],
        "跟随后会出现 `GET /Timing`——多一条就说明 redirect 没禁掉"
    );
}

/// ⑤ 403 立刻停（`Forbidden` 在编排层算「整轮到此为止」），且不重试 PUT。
#[tokio::test]
async fn mkcol_403_is_forbidden_and_stops() {
    let server = DirServer::new(&[]);
    server.fail_mkcol_with(403);
    let target = target(&server, "/Timing/md");

    let err = put(&target, REL, b"# x", None)
        .await
        .expect_err("403 必须失败");
    assert_eq!(err, WebdavError::Forbidden, "必须落到 Forbidden 而不是 Server(403)");
    assert_eq!(
        server.method_paths(),
        vec!["PUT /Timing/md/2026-11-07.md", "MKCOL /Timing"],
        "第 1 级就 403：不许继续建第 2 级，也不许重试 PUT"
    );
}

/// ⑥ 第 1 级建成、第 2 级 409 → 立刻停，**已建的那一级留着**（不回滚）。
#[tokio::test]
async fn parent_missing_409_stops_the_cascade() {
    let server = DirServer::new(&[]);
    server.fail_mkcol_at("/Timing/md", 409);
    let target = target(&server, "/Timing/md");

    let err = put(&target, REL, b"# x", None)
        .await
        .expect_err("第 2 级建不出来，补建后仍会失败");
    assert_eq!(err, WebdavError::Server(409), "409 的本义不许被改写");
    assert_eq!(
        server.method_paths(),
        vec![
            "PUT /Timing/md/2026-11-07.md",
            "MKCOL /Timing",
            "MKCOL /Timing/md",
        ],
        "409 立刻停：不许继续第 3 级，也不许重试 PUT"
    );
    assert_eq!(
        server.dirs(),
        vec!["/Timing"],
        "已建出来的上级目录必须保留（远端 DELETE 是不可撤销的破坏性动作）"
    );
}

/// ⑦ 超过 8 级：一个 MKCOL 都不发。
#[tokio::test]
async fn deep_base_path_makes_no_request() {
    let deep = "/l1/l2/l3/l4/l5/l6/l7/l8/l9";
    let server = DirServer::new(&[]);
    let target = target(&server, deep);
    assert_eq!(target.dir_levels().len(), 9, "用例自己的前提");

    let outcome = ensure_base_dir(&target)
        .await
        .expect("太深不是错误：由调用方决定怎么说");
    assert_eq!(outcome, EnsureOutcome::TooDeep { levels: 9 });
    assert!(
        server.hits().is_empty(),
        "一个请求都不许发：{}",
        server.method_paths().join(", ")
    );
    assert_eq!(MAX_LEVELS, 8, "上限是契约的一部分（文案里说「最多 8 级」）");

    /* 从 `put` 进也一样：只剩那一次 409 的 PUT，降级成 Server(409)。 */
    let err = put(&target, REL, b"# x", None)
        .await
        .expect_err("目录建不出来，PUT 仍是 409");
    assert_eq!(err, WebdavError::Server(409));
    assert_eq!(server.hits().len(), 1, "只有那次 409 的 PUT");
}

/// ⑧ 空 basePath = 服务地址根目录：零 MKCOL。
#[tokio::test]
async fn empty_base_path_skips_mkcol() {
    let server = DirServer::new(&[]);
    let target = target(&server, "");
    let outcome = ensure_base_dir(&target).await.expect("根目录永远存在");
    assert_eq!(
        outcome,
        EnsureOutcome::Ready {
            created: 0,
            levels: 0
        }
    );
    assert!(server.hits().is_empty(), "根级不该有任何请求");
    put(&target, REL, b"# x", None)
        .await
        .expect("根目录下写文件应成功");
    assert_eq!(server.method_paths(), vec!["PUT /2026-11-07.md"]);
}

/// ⑨ 目录建出来了、PUT 仍 409：上抛 `Server(409)`，只重试一次。
#[tokio::test]
async fn retry_after_ensure_still_409_is_server_409() {
    let server = DirServer::new(&[]);
    server.fail_put_with(409);
    let target = target(&server, "/Timing/md");

    let err = put(&target, REL, b"# x", None)
        .await
        .expect_err("补建之后仍 409 必须失败");
    assert_eq!(err, WebdavError::Server(409), "不改写 409 的本义");
    let paths = server.method_paths();
    assert_eq!(paths.len(), 4, "只重试一次：{paths:?}");
    assert_eq!(
        paths.iter().filter(|line| line.starts_with("PUT ")).count(),
        2,
        "PUT 恰好两次（原始 + 一次重试）"
    );
    assert_eq!(
        paths.iter().filter(|line| line.starts_with("MKCOL ")).count(),
        2,
        "两级各一次 MKCOL"
    );
}

/// ⑪ 同一轮里后续文件**不会再发 MKCOL**（「天然只有一次级联」的机器证据）。
#[tokio::test]
async fn second_put_in_same_round_sends_no_mkcol() {
    let server = DirServer::new(&[]);
    let target = target(&server, "/Timing/md");
    put(&target, REL, b"# x", None).await.expect("第一份要成功");

    let before = server.hits().len();
    put(&target, "2026-11-06.md", b"# y", None)
        .await
        .expect("目录已在，第二份直接写");
    let paths: Vec<String> = server.method_paths()[before..].to_vec();
    assert_eq!(
        paths,
        vec!["PUT /Timing/md/2026-11-06.md"],
        "第二次 PUT 不该再触发任何 MKCOL"
    );
}

/// ⑫ `basePath` 含非 ASCII（设计 §2.2 那张表的第 5 行）：MKCOL 的 URL 必须与 `url_for`
/// 的路径前缀**逐字符相同**——都交给 reqwest 编码一次，谁也不许二次编码。
#[tokio::test]
async fn non_ascii_base_path_builds_the_same_url_as_put() {
    let server = DirServer::new(&[]);
    let target = target(&server, "/我的 md");
    put(&target, REL, b"# x", None).await.expect("补建后应成功");

    let encoded = "/%E6%88%91%E7%9A%84%20md";
    assert_eq!(
        server.method_paths(),
        vec![
            format!("PUT {encoded}/{REL}"),
            format!("MKCOL {encoded}"),
            format!("PUT {encoded}/{REL}"),
        ],
        "MKCOL 的路径必须是 PUT 路径的前缀，且不出现二次编码（%25）"
    );
}
