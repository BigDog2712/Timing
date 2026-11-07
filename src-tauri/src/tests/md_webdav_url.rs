//! 「写文件」与「建目录」两条路径拼出的是**同一个 URL**（V0.11.15，设计 §2.2）。
//!
//! 单独一个文件是行数纪律逼出来的：`md_webdav_dir.rs` 已经 277 行，这条用例连注释
//! 40 行，塞进去就过 300。它与那边共用同一套假服务器，只是判据不同：那边问「发了哪些
//! 请求」，这里问「两条路径的 URL 是否逐字符同源」。
//!
//! ## 为什么非 ASCII 那条不够，必须再加 `%` 与 `+`
//!
//! `/我的 md` 两边都会被 reqwest 编码一次：**原样拼接**（生产写法）与**手工
//! `encode_rel` 一次**得到的是同一个 URL，用例绿了也分不出对错——QA 变异实测：给
//! `dir_url` 加上 `encode_rel` 后 `md_webdav_dir.rs` 的 11 条全绿。
//!
//! 设计 §2.2 表格里真正分得出来的是「编码已经发生过」的输入：
//!
//! | `base_path` | 正确（原样拼接） | 手工补编码（错） |
//! |---|---|---|
//! | `/Timing/%E6%88%91` | `%E6%88%91` 原样保留 | `%25E6%2588%2591`（二次编码） |
//! | `/a+b` | `+` 原样保留 | `%2B` |
//!
//! 错的那一列不是「日志难看」：MKCOL 建的是**另一个**目录，父级永远缺失，于是 PUT
//! 补建之后仍然 409——用户填一个合法的 `%` 目录就再也写不上去（本文件第一条用例在
//! 变异版本里报的就是 `Server(409)`）。

use crate::infra::md_webdav::{put, WebdavTarget};
use crate::tests::fake_webdav_dir::DirServer;

fn target(server: &DirServer, base_path: &str) -> WebdavTarget {
    WebdavTarget::new(&server.base_url, base_path, "u", "p")
}

const REL: &str = "2026-11-07.md";

/// MKCOL 的 URL 必须逐字符是 PUT 路径的前缀（三条 `base_path`：已编码段 / `+` / 非 ASCII）。
#[tokio::test]
async fn mkcol_url_is_a_prefix_of_the_put_url_when_encoding_happened() {
    for raw in ["/Timing/%E6%88%91", "/a+b", "/Timing/我的 md"] {
        let server = DirServer::new(&[]);
        let target = target(&server, raw);
        put(&target, REL, b"# x", None)
            .await
            .unwrap_or_else(|err| panic!("{raw} 补建后应成功（否则 MKCOL 建到了别的目录）：{err:?}"));

        let paths = server.method_paths();
        let put_url = paths
            .iter()
            .find_map(|line| line.strip_prefix("PUT "))
            .unwrap_or_else(|| panic!("{raw} 应发出 PUT：{paths:?}"))
            .to_string();
        let mut mkcols = 0;
        for line in &paths {
            let Some(dir_url) = line.strip_prefix("MKCOL ") else {
                continue;
            };
            mkcols += 1;
            assert!(
                put_url.starts_with(&format!("{dir_url}/")),
                "{raw}：MKCOL 的 URL 必须是 PUT 的路径前缀（两条路径同源拼接、都只编码一次）；\
                 MKCOL={dir_url} / PUT={put_url}"
            );
        }
        assert!(mkcols > 0, "{raw} 应有 MKCOL：{paths:?}");
    }
}
