//! QA 独立验收 · T01 边界补例（严过关，v0.11.19）。
//!
//! 补的是工程师那 14 条里没有覆盖、但 T02 提频后最容易踩的几格：
//! - ① 闭合标记后带语言标注（F4）→ 应判未闭合 → `Blocked`；补纯 ``` 即恢复；
//! - ② CRLF + BOM 首行 + 围栏标记行带尾随空格，走 `read_section` / `write_section` 真实
//!   IO（不是只调纯函数），并顺带钉住「别人围栏里那行逐字标题逐字节不变」（洞 2）；
//! - ③ 目标标题行本身带 3 空格缩进仍命中（§2.6）、4 空格走 `Mismatched`；
//!   `~~~` 与 ``` 交叉配对（F3）；
//! - ④ 围栏外的 `# 备注` **仍应被当标题**（既有语义，别把修过头当 bug）；
//! - ⑤ §11.1 三句文案逐字 + `guard()` 的阻断 / 非阻断；
//! - ⑥ 未闭合围栏在我方标题之前不阻断，补上闭合即恢复。
//!
//! 变异自检的两处靶子就在本文件：改 `md_fence::closes()` 的空白检查 → 用例①红；
//! 把 `md_section::MAX_HEADING_INDENT` 从 3 改成 2 → 用例③红。

use crate::infra::md_section::{SectionIssue, SectionRead, SectionState};
use crate::infra::{md_fence, md_file, md_section};
use crate::tests::support::unique_dir;

const TIMERS: &str = "#### 事项计时";
const BOM: char = '\u{feff}';

const DUP_TEXT: &str = "文件里有 2 个「事项计时」标题，请只留一个。";
const MISMATCH_TEXT: &str = "文件里的「事项计时」标题等级与设置不一致，请改文件或改设置。";
const UNCLOSED_TEXT: &str =
    "文件里的代码块没有收尾（缺少结尾的三个反引号），本轮没有读写「事项计时」这一节。";

/// 落一个临时文件，返回路径（内容与字节由调用方给，保留 CRLF / BOM 原样）。
fn doc(tag: &str, bytes: impl AsRef<[u8]>) -> std::path::PathBuf {
    let dir = unique_dir(tag);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("2026-11-19.md");
    std::fs::write(&path, bytes).unwrap();
    path
}

/// ① 闭合标记后带语言标注不算闭合（F4）：` ```yaml ` 不能关掉 ` ``` ` 围栏。
#[test]
fn qa_edge_closing_fence_with_language_tag_does_not_close() {
    let bad = format!(
        "{TIMERS}\n- [ ] 写代码\n```yaml\n# 备注\n```yaml\n- [ ] 第二段\n#### 读书\n手写\n"
    );
    let read = md_file::read_section(&doc("qa-t01-closer-info", bad.as_bytes()), TIMERS).unwrap();
    assert!(
        matches!(read.state, SectionState::Blocked { .. }),
        "闭合标记带语言标注 → 围栏仍未闭合 → 本轮不写不导入：{:?}",
        read.state
    );
    let issue = read
        .issues
        .iter()
        .find(|i| matches!(i, SectionIssue::UnclosedFence { .. }))
        .expect("应报未闭合围栏");
    assert!(issue.blocks());
    assert_eq!(issue.text("事项计时"), UNCLOSED_TEXT);

    /* 用户补上一个「行内只有围栏」的闭合标记即恢复。 */
    let fixed = format!(
        "{TIMERS}\n- [ ] 写代码\n```yaml\n# 备注\n```\n- [ ] 第二段\n#### 读书\n手写\n"
    );
    let read = md_file::read_section(&doc("qa-t01-closer-info-fixed", fixed.as_bytes()), TIMERS)
        .unwrap();
    match read.state {
        SectionState::Present { body, .. } => {
            assert!(body.contains("# 备注"), "围栏里那行属于正文：{body}");
            assert!(body.contains("- [ ] 第二段"));
            assert!(!body.contains("手写"), "不许把下一节吞进来：{body}");
        }
        other => panic!("补上收尾后应恢复 Present：{other:?}"),
    }
    assert!(read.issues.is_empty(), "{:?}", read.issues);
}

/// ② CRLF + BOM 首行 + 围栏标记行带尾随空格，走真实读写；别人的围栏段逐字节不变。
#[test]
fn qa_edge_crlf_bom_trailing_space_fence_roundtrip() {
    /* 别人的区块（含逐字标题）全部放在真标题之前：`write_section` 的
       `lines[..=head_idx]` 会原样保留，于是这一段是逐字节可比的。 */
    let foreign = concat!(
        "顶部说明段（CRLF + BOM 首行）\n",
        "\n",
        "#### 读书\n",
        "别人的手写第一行（一个字都不许动）\n",
        "```   \n", // 开标记带 3 个尾随空格
        "# 备注\n",
        "#### 事项计时\n", // 围栏里逐字标题，洞 2 的形状
        "这行是别人的示例文本\n",
        "```  \n", // 闭合标记带 2 个尾随空格
        "别人的手写最后一行（一个字都不许动）\n",
        "\n",
        "#### 事项计时\n", // 真标题
    );
    let lf = format!("{foreign}- [ ] 旧内容\n#### 尾声\n尾声手写，不许动\n");
    let crlf = format!("{BOM}{}", lf.replace('\n', "\r\n"));
    let path = doc("qa-t01-crlf-bom", crlf.as_bytes());

    let read = md_file::read_section(&path, TIMERS).unwrap();
    match &read.state {
        SectionState::Present { body, .. } => {
            assert_eq!(body, "- [ ] 旧内容", "围栏内标题不算命中，区块没被吞：{body}");
        }
        other => panic!("应 Present：{other:?}"),
    }
    assert!(read.issues.is_empty(), "带尾随空格的围栏标记应正常闭合：{:?}", read.issues);

    md_file::write_section(&path, TIMERS, "- [ ] 新渲染").unwrap();
    let after = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();

    assert!(after.starts_with(BOM), "BOM 要写回：{:?}", &after[..8.min(after.len())]);
    assert_eq!(after.matches(BOM).count(), 1, "全文只有一个 BOM");
    assert!(
        !after.replace("\r\n", "").contains('\n'),
        "纯 CRLF 文件写回后仍是纯 CRLF（无裸 LF）"
    );
    assert!(
        after.starts_with(&format!("{BOM}{}", foreign.replace('\n', "\r\n"))),
        "别人的整段（含围栏、逐字标题、尾随空格、手写行）逐字节不变：\n{after}"
    );
    assert!(after.contains("尾声手写，不许动\r\n"), "区块外的手写内容逐字节不动");
    assert!(after.contains("- [ ] 新渲染\r\n"), "我方区块在原位被更新");

    let lines: Vec<&str> = after.split('\n').collect();
    let fences = md_fence::scan(&lines);
    assert_eq!(
        md_section::count_exact(&lines, &fences, TIMERS),
        1,
        "围栏里那行不算标题"
    );
    assert_eq!(after.matches(TIMERS).count(), 2, "围栏里那份示例原样保留");
}

/// ③ 3 空格缩进的目标标题仍命中；4 空格走 `Mismatched`；`~~~` 与 ``` 各按各的配对。
#[test]
fn qa_edge_three_space_heading_and_tilde_backtick_crossing() {
    let three = format!("   {TIMERS}\n- [ ] 甲\n#### 读书\n");
    let lines: Vec<&str> = three.split('\n').collect();
    let fences = md_fence::scan(&lines);
    assert_eq!(
        md_section::find_heading(&lines, &fences, TIMERS),
        Some((0, 4)),
        "缩进 ≤3 空格按 CommonMark 仍是标题"
    );
    assert_eq!(md_section::count_exact(&lines, &fences, TIMERS), 1);

    let four = format!("    {TIMERS}\n- [ ] 甲\n");
    let read = md_file::read_section(&doc("qa-t01-indent4", four.as_bytes()), TIMERS).unwrap();
    assert!(
        matches!(read.state, SectionState::Blocked { .. }),
        "4 空格缩进 → 找不到配置标题 → Mismatched 阻断、不追加第二节：{:?}",
        read.state
    );
    let issue = read
        .issues
        .iter()
        .find(|i| matches!(i, SectionIssue::Mismatched { .. }))
        .expect("应报等级不一致");
    assert_eq!(issue.text("事项计时"), MISMATCH_TEXT);

    /* F3：`~~~` 围栏里的 ``` 只是内容，关不掉；只有同字符的 ~~~ 才闭合。 */
    let cross = ["~~~", "# 备注", "```", TIMERS, "~~~", "#### 读书"];
    let f = md_fence::scan(&cross);
    assert!(f.is_inside(2), "``` 关不掉 ~~~ 围栏");
    assert!(f.is_inside(3), "围栏里的逐字标题不是结构行");
    assert_eq!(f.unclosed_at(), None, "~~~ 已闭合");
    assert!(!f.is_inside(5), "闭合后的行回到围栏外");
}

/// ④ 围栏外的 `# 备注` 仍应被当标题（既有语义，不是「修过头」）。
#[test]
fn qa_edge_outside_fence_hash_note_is_still_a_heading() {
    let text = format!("{TIMERS}\n- [ ] 甲\n# 备注\n- [ ] 乙\n#### 读书\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head, level) = md_section::find_heading(&lines, &fences, TIMERS).unwrap();
    let end = md_section::section_end(&lines, &fences, head, level);
    assert_eq!(lines[end], "# 备注", "围栏外的 # 行按既有语义仍是标题");
    assert_eq!(md_file::body_in_text(&text, TIMERS).as_deref(), Some("- [ ] 甲"));
}

/// ⑤ §11.1 三句逐字 + `guard()` 的阻断 / 非阻断分流。
#[test]
fn qa_edge_three_wordings_and_guard_are_verbatim() {
    let dup = SectionIssue::Duplicate { count: 2, line: 3 };
    let mis = SectionIssue::Mismatched { level: 3, line: 0 };
    let unc = SectionIssue::UnclosedFence { line: 5 };
    assert_eq!(dup.text("事项计时"), DUP_TEXT);
    assert_eq!(mis.text("事项计时"), MISMATCH_TEXT);
    assert_eq!(unc.text("事项计时"), UNCLOSED_TEXT);
    assert!(!dup.blocks(), "Duplicate 不阻断写入");
    assert!(mis.blocks());
    assert!(unc.blocks());

    let dummy = || SectionState::MissingHeading { mtime_ms: 0 };
    let read = SectionRead { state: dummy(), issues: vec![dup] };
    assert_eq!(
        read.guard("timers", "事项计时").unwrap(),
        vec![DUP_TEXT.to_string()],
        "非阻断诊断以 Ok(提示) 交回调用方"
    );
    let read = SectionRead { state: dummy(), issues: vec![unc] };
    assert_eq!(
        read.guard("timers", "事项计时").unwrap_err(),
        UNCLOSED_TEXT,
        "阻断诊断以 Err(逐字文案) 交回调用方"
    );
    assert!(
        !UNCLOSED_TEXT.chars().any(|c| c.is_ascii_digit()),
        "文案里不许出现三位数字（行号只进日志）"
    );
}

/// ⑥ 未闭合围栏在我方标题之前 → 不阻断；补上闭合标记 → 恢复 Present。
#[test]
fn qa_edge_unclosed_before_heading_is_not_blocking_and_recovers() {
    let before = format!("# 日记\n```\n{TIMERS}\n- [ ] 假\n");
    let read = md_file::read_section(&doc("qa-t01-unclosed-before", before.as_bytes()), TIMERS)
        .unwrap();
    assert!(
        matches!(read.state, SectionState::MissingHeading { .. }),
        "标题被围栏吞掉，但不是阻断级：{:?}",
        read.state
    );
    assert!(read.issues.is_empty(), "{:?}", read.issues);

    let fixed = format!("# 日记\n```\n{TIMERS}\n```\n{TIMERS}\n- [ ] 真\n");
    let read = md_file::read_section(&doc("qa-t01-unclosed-fixed", fixed.as_bytes()), TIMERS)
        .unwrap();
    assert!(matches!(read.state, SectionState::Present { .. }), "{:?}", read.state);
    assert!(read.issues.is_empty(), "{:?}", read.issues);
}
