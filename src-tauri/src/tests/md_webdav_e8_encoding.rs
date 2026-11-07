//! [V0.11.16] E8 的**本机可验部分**：默认远端目录含中文时，客户端实际发出去的请求行里
//! 中文段必须是**百分号编码一次**的形态（PRD 6.2 / E8）。
//!
//! 判据拆成两条，缺一条都会漏掉一种真实故障：
//!
//! 1. **编码一次**：请求行里不许出现原始中文，也不许出现 `%25E6`（二次编码）。
//!    二次编码是「配置看不出问题、但就是连不上」的典型成因——服务端收到的是另一个
//!    目录名，父级永远缺失。
//! 2. **MKCOL 与 PUT 用同一份编码**：前者建目录、后者写文件，两者一旦不同源，
//!    就会出现「目录建好了、文件还是 409」。
//!
//! 本用例只证明**客户端**行为（这部分不依赖网络，可以本机钉死）。「坚果云是否接受这种
//! 形态」必须真机点一次「测试连接」，本机验不了（见 PRD R-1）。

use crate::infra::md_webdav::{WebdavTarget, put};
use crate::tests::fake_webdav_dir::DirServer;

/// 与默认预填值同形（PRD 裁决 Q1）。
const DIR: &str = "/我的坚果云/Timing";
const REL: &str = "2026-11-07.md";

/// 「我的坚果云」的 UTF-8 百分号编码（`url` crate 用大写十六进制）。
const ENCODED: &str = "%E6%88%91%E7%9A%84%E5%9D%9A%E6%9E%9C%E4%BA%91";

#[tokio::test]
async fn chinese_base_path_is_percent_encoded_exactly_once_on_the_wire() {
    let server = DirServer::new(&[]);
    let target = WebdavTarget::new(&server.base_url, DIR, "u", "p");
    /* 409 补建（MKCOL 每一级）→ 再 PUT。两条路径都会出现在 `method_paths()` 里。 */
    put(&target, REL, b"# x", None)
        .await
        .unwrap_or_else(|err| panic!("补建后应能写入：{err:?}"));

    let paths = server.method_paths();
    assert!(paths.len() >= 2, "应至少有一次 MKCOL 与一次 PUT：{paths:?}");

    for line in &paths {
        assert!(
            line.is_ascii(),
            "请求行里不许出现原始中文（说明没过 `url` crate）：{line}"
        );
        assert!(
            !line.to_uppercase().contains("%25E6"),
            "出现了二次编码（`%25E6` = `%` 自己又被编码了一次）：{line}"
        );
    }

    let encoded_once = |line: &str| line.to_uppercase().contains(ENCODED);
    assert!(
        paths.iter().any(|line| line.starts_with("MKCOL ") && encoded_once(line)),
        "MKCOL 的 URL 应带着编码后的中文目录：{paths:?}"
    );
    assert!(
        paths.iter().any(|line| line.starts_with("PUT ") && encoded_once(line)),
        "PUT 的 URL 应带着编码后的中文目录：{paths:?}"
    );
    /* 保存值里存的是中文（不转码），显示与存储都是可读形态（PRD 6.2 第 2、3 条） */
    assert_eq!(target.base_path, DIR, "`base_path` 应原样保留中文");
}
