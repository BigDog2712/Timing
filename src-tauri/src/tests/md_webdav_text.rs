//! `fail_text` 的文案判据（设计 §2.6 / §6.3 最后一条）：纯函数，不打网络。
//!
//! 这是本轮唯一能拦住「文案里漏出 401 / 409」的机器判据——PRD 5.2 口径 2
//! （状态码只进日志、不给用户看）靠它兜底。放在单独文件里是因为 `md_webdav_dir.rs`
//! 已经把 300 行预算用在大半在假服务器上了。

use crate::infra::md_webdav::WebdavError;
/* `fail_text` 走 `round_push::`（既有 3 个调用点的路径，本轮要求一字不改）；
   `dir_label` / `fail_text_at` / `FailStage` 走 `text::`（文案表的定义处）。 */
use crate::services::md_cloud::round_push::fail_text;
use crate::services::md_cloud::text::{FailStage, dir_label, fail_tag, fail_text_at};

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
    /* 带路径的三类：文案里必须出现用户填的那串目录。
       [V0.11.16] 403 那一条的关键词从「账号能登录」改成「写不进去」：R9 把旧那句
       「账号能登录，但没有写文件的权限」拆成了「建不出来」/「写不进去」两句，自动同步
       路径（`fail_text` == `Push` 关卡）拿到的是后者。 */
    let with_path = [
        (WebdavError::Forbidden, "写不进去"),
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
///
/// [V0.11.16] 扩到 `fail_text_at` 的**全部关卡** × 全部变体：403 拆成四句之后，
/// 「哪一句里漏了状态码」是新出现的风险面。
#[test]
fn no_bare_status_code_in_any_fail_text() {
    let dir = "/我的坚果云/Timing";
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
        /* 四个关卡（`Dir` 的 ready=0 / ready>0 是两句不同的话，都要过） */
        for stage in [
            FailStage::Push,
            FailStage::Account,
            FailStage::Dir { level: dir, ready: 0 },
            FailStage::Dir { level: dir, ready: 1 },
            FailStage::Write,
        ] {
            let at = fail_text_at(stage, &err, dir);
            assert!(!three_digit_run(&at), "{err:?} 在某一关漏了状态码：{at}");
        }
    }
}

/// ⑫ R9：同一个 403 在**不同关卡**上说不同的话，各给一个动作。
///
/// 这是本轮「用户自己能分辨」的核心判据：v0.11.15 那句把三种可能并列，用户读完仍不
/// 知道该动哪一个；现在「建不出来」与「写不进去」由程序自己在第 2 / 3 关分开。
#[test]
fn forbidden_text_splits_by_stage() {
    let dir = "/我的坚果云/Timing";

    let push = fail_text_at(FailStage::Push, &WebdavError::Forbidden, dir);
    assert!(push.contains("写不进去"), "{push}");
    assert!(!push.contains("建不出来"), "自动同步的 403 不该说目录建不出来：{push}");
    assert!(push.contains("拖一个文件"), "要给出那个对照实验：{push}");
    /* 旧签名 == `Push` 关卡：既有 3 个调用点的语义一个字都没变 */
    assert_eq!(push, fail_text(&WebdavError::Forbidden, dir));

    let account = fail_text_at(FailStage::Account, &WebdavError::Forbidden, dir);
    assert!(account.contains("账号能登录"), "{account}");
    assert!(account.contains("同一台服务端"), "{account}");

    let first = fail_text_at(FailStage::Dir { level: dir, ready: 0 }, &WebdavError::Forbidden, dir);
    assert!(first.contains("第一级"), "第一级就没建出来：{first}");
    assert!(first.contains(dir), "{first}");

    let deeper = fail_text_at(FailStage::Dir { level: dir, ready: 1 }, &WebdavError::Forbidden, dir);
    assert!(deeper.contains("这一级建不出来"), "{deeper}");
    assert!(deeper.contains("「/我的坚果云」已就绪"), "要点明上级已经就绪：{deeper}");
    assert!(deeper.contains("名字用「Timing」"), "动作要具体到那一段名字：{deeper}");
    assert!(!deeper.contains("拖一个文件"), "第 2 关不该说第 3 关的话：{deeper}");

    let write = fail_text_at(FailStage::Write, &WebdavError::Forbidden, dir);
    assert_eq!(write, push, "第 3 关与自动同步说同一句：目录都已就绪");
}

/// ⑬ R13 退路：路径含中文时追加一句可执行的退路（英文路径不加）。
#[test]
fn non_ascii_hint_only_for_non_ascii_paths() {
    let hint = "改成英文再试一次";
    let chinese = fail_text_at(
        FailStage::Dir { level: "/我的坚果云/Timing", ready: 1 },
        &WebdavError::Forbidden,
        "/我的坚果云/Timing",
    );
    assert!(chinese.contains(hint), "{chinese}");

    let ascii = fail_text_at(
        FailStage::Dir { level: "/Vault/Timing", ready: 1 },
        &WebdavError::Forbidden,
        "/Vault/Timing",
    );
    assert!(!ascii.contains(hint), "纯英文路径不该出现中文退路：{ascii}");
    /* 与「名字」无关的失败不加：超时是网络问题，不是目录名问题 */
    let timeout = fail_text_at(FailStage::Account, &WebdavError::Timeout, "/我的坚果云/Timing");
    assert!(!timeout.contains(hint), "{timeout}");
}

/// ⑭ [QA F5 / G2] 日志词表：`Server` 带状态码，且两份实现逐变体一致。
///
/// 这轮之前「`infra::md_webdav::tag` 与 `services::text` 是同一套词表」只是两处注释的
/// 自称——谁改一边都不会红。现在它是机器判据：排障 grep（`fail=Server(400)`）的契约在这里。
/// [QA G2] `fail_tag` 从 `dir.rs` 搬到 `tag.rs`（那边只剩 2 行余量），import 跟着改；
/// 判据一个字没变——搬文件不该顺手放宽断言。
///
/// 为什么必须是 `Server(<码>)` 而不是 `Server`：400（名字里有服务端不接受的字符 →
/// 改目录名）与 5xx（服务端自己出错 → 等一等自动重试）的处置完全相反，丢码就只能靠猜。
#[test]
fn log_vocabulary_agrees_and_carries_status_code() {
    let cases = [
        WebdavError::Auth,
        WebdavError::Forbidden,
        WebdavError::RateLimited,
        WebdavError::Precondition,
        WebdavError::NotFound,
        WebdavError::Timeout,
        WebdavError::Network("连不上".into()),
        WebdavError::Server(400),
        WebdavError::Server(409),
        WebdavError::Server(503),
    ];

    for err in &cases {
        let service = fail_tag(err).to_string();
        let infra = crate::infra::md_webdav::tag::fail_tag(err).to_string();
        assert_eq!(service, infra, "两份日志词表必须逐变体一致（{err:?}）");
        /* 词表是给 `fail={}` 用的：不许有空格、不许是空串 */
        assert!(!service.is_empty() && !service.contains(' '), "{service}");
    }

    /* 非 `Server` 变体沿用 v0.11.13 起的旧词，别顺手改名（已有日志靠它 grep） */
    assert_eq!(fail_tag(&WebdavError::Auth).to_string(), "Auth");
    assert_eq!(fail_tag(&WebdavError::Forbidden).to_string(), "Forbidden");
    assert_eq!(fail_tag(&WebdavError::NotFound).to_string(), "NotFound");
    assert_eq!(fail_tag(&WebdavError::Network("x".into())).to_string(), "Network");

    /* `Server` 带码：三个码互不相同，且不是退化后的裸 `Server` */
    for code in [400u16, 409, 423, 503] {
        let tag = fail_tag(&WebdavError::Server(code)).to_string();
        assert_eq!(tag, format!("Server({code})"));
        assert_ne!(tag, "Server", "退化回裸 `Server` 就分不清是哪一类了");
    }

    /* 这条词表**只进日志**：`fail_text` 的输出里仍然一个三位数都没有（F5 不得污染文案） */
    for code in [400u16, 409, 423, 503] {
        let err = WebdavError::Server(code);
        let text = fail_text(&err, "/Timing/md");
        assert!(!three_digit_run(&text), "日志词表不许渗进用户文案：{text}");
    }
}
