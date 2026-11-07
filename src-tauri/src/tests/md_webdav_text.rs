//! `fail_text` 的文案判据（设计 §2.6 / §6.3 最后一条）：纯函数，不打网络。
//!
//! 这是本轮唯一能拦住「文案里漏出 401 / 409」的机器判据——PRD 5.2 口径 2
//! （状态码只进日志、不给用户看）靠它兜底。放在单独文件里是因为 `md_webdav_dir.rs`
//! 已经把 300 行预算用在大半在假服务器上了。

use crate::infra::md_webdav::WebdavError;
use crate::services::md_cloud::round_push::{dir_label, fail_text};

/// ⑩ 纯函数：文案分两类，且**都不含任何裸状态码**（`\b\d{3}\b` 零命中）。
///
/// 这是本轮唯一能拦住「文案里漏出 401 / 409」的机器判据（PRD 5.2 口径 2 靠它兜底）。
///
/// 「带路径」只要求 403 / 409 / 400 三类：它们是用户**能自己动手解决**的三种情形
/// （改权限 / 手动建目录 / 改目录名），路径是他唯一的行动依据。兜底那一类（其余 4xx、
/// 423 Locked、5xx）说的是「把日志发给开发者」——那里的路径进日志，不进这句话，
/// 主理人对 5xx 的裁决与设计 §2.6 都按这个口径。
#[test]
fn fail_text_carries_real_path() {
    let dir = "/Timing/md";
    /* 带路径的三类：文案里必须出现用户填的那串目录。 */
    let with_path = [
        (WebdavError::Forbidden, "账号能登录"),
        (WebdavError::Server(409), "这台服务器不允许程序自动建"),
        (WebdavError::Server(400), "不接受的字符"),
    ];
    for (err, expect) in with_path {
        let text = fail_text(&err, dir);
        assert!(text.contains(dir), "文案必须带出真实路径：{text}");
        assert!(!three_digit_run(&text), "文案里不许出现裸状态码：{text}");
        assert!(text.contains(expect), "文案该说「{expect}」：{text}");
    }
    /* 兜底两类：不承诺路径，只承诺「把日志发给开发者」——但同样不许出现状态码。 */
    let fallback = [
        (WebdavError::Server(423), "没有给出可读的原因"),
        (WebdavError::Server(503), "稍后会自动重试"),
    ];
    for (err, expect) in fallback {
        let text = fail_text(&err, dir);
        assert!(!three_digit_run(&text), "文案里不许出现裸状态码：{text}");
        assert!(text.contains(expect), "兜底文案该说「{expect}」：{text}");
        assert!(
            text.contains("发给开发者"),
            "兜底文案必须给出下一步（把日志发给开发者）：{text}"
        );
    }
    /* 空路径要说成「服务地址根目录」，不能显示一对空引号。 */
    assert_eq!(dir_label(""), "（服务地址根目录）");
    assert_eq!(dir_label("/Timing/md"), "「/Timing/md」");
    assert!(fail_text(&WebdavError::Server(400), "").contains("（服务地址根目录）"));
}

/// 是否存在**恰好三位**的连续数字（= 正则 `\b\d{3}\b` 命中）。
///
/// 四位以上不命中：`1234` 在第三个数字处没有词边界。这正是我们想要的语义
/// （「8 级」「每级」是允许的，「409」不是）。
fn three_digit_run(text: &str) -> bool {
    let mut run = 0usize;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            run += 1;
            continue;
        }
        if run == 3 {
            return true;
        }
        run = 0;
    }
    run == 3
}

/// ⑪ `three_digit_run` 要对**每一个**变体生效。
///
/// 上一条只挑了 5 个变体（403 / 409 / 400 / 423 / 503），于是给 `Auth` 文案塞一句
/// 「（返回 401）」它照样绿——用户能看到的每一句都得过这道闸，不是抽查。
#[test]
fn no_bare_status_code_in_any_fail_text() {
    let dir = "/Timing/md";
    let all = [
        WebdavError::Auth,
        WebdavError::Forbidden,
        WebdavError::RateLimited,
        WebdavError::Precondition,
        WebdavError::NotFound,
        WebdavError::Timeout,
        WebdavError::Network("连不上（本机探针）".into()),
        WebdavError::Server(400),
        WebdavError::Server(409),
        WebdavError::Server(423),
        WebdavError::Server(500),
        WebdavError::Server(503),
    ];
    for err in all {
        let text = fail_text(&err, dir);
        assert!(
            !three_digit_run(&text),
            "{err:?} 的文案里出现了裸状态码：{text}"
        );
        let empty = fail_text(&err, "");
        assert!(
            !three_digit_run(&empty),
            "{err:?}（空路径）的文案里出现了裸状态码：{empty}"
        );
    }
}
