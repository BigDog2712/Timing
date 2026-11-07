//! 区块扫描器的围栏判据（V0.11.19 变更 B，设计 §2.3–§2.6）。
//!
//! 两个洞各一组用例：
//!
//! - **洞 1（`section_end`）**：区块里的 `# 备注` 原本会被当标题 → body 被截断 →
//!   走导入 → 删除块把「基线有、截断后没有」的计时段软删，没有撤销入口。
//! - **洞 2（`find_heading`）**：别人代码围栏里一行逐字 `#### 事项计时` 会被当成区块起点
//!   → `write_section` 从那儿替换到下一个标题 → **改写别人写的内容**，不可逆。
//!
//! 用例⑥⑦⑫ 是洞 2 的守卫：变异自检（去掉 `find_heading` 的围栏判断）必须让它们红。
//! 用例① 是洞 1 的守卫：去掉 `section_end` 的围栏判断必须让它红。

use crate::infra::md_file;
use crate::infra::md_fence;
use crate::infra::md_section::{self, SectionIssue, SectionState};
use crate::tests::support::unique_dir;

const TIMERS: &str = "#### 事项计时";
const NOTES: &str = "#### 便利贴";

/// 围栏外的区块结束行（按行文本返回，`<EOF>` 表示读到文件末尾）。
fn end_line_of(text: &str, heading: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, level) = md_section::find_heading(&lines, &fences, heading).expect("应有标题");
    let end = md_section::section_end(&lines, &fences, head_idx, level);
    lines.get(end).copied().unwrap_or("<EOF>").to_string()
}

/// 落一个临时文件并读它（`read_section` 是唯一会产出 `SectionRead` 的入口）。
fn read_text(tag: &str, text: &str, heading: &str) -> md_section::SectionRead {
    let dir = unique_dir(tag);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("2026-11-19.md");
    std::fs::write(&path, text).unwrap();
    md_file::read_section(&path, heading).expect("读区块应成功")
}

// ---------------------------------------------------------------- 洞 1：区块被截断

/// ① 已闭合的 ``` 里的 `# 备注` 不截断区块（J9）。
#[test]
fn yaml_comment_in_closed_fence_does_not_truncate_section() {
    let doc = "#### 事项计时\n- [ ] 写代码\n```\n# 备注\n```\n- [ ] 第二段\n#### 便利贴\n\n表格\n";
    let body = md_file::body_in_text(doc, TIMERS).expect("应找到标题");
    assert!(body.contains("# 备注"), "围栏里的注释属于正文：{body}");
    assert!(body.contains("- [ ] 第二段"), "围栏之后的内容也要读到：{body}");
    assert_eq!(end_line_of(doc, TIMERS), NOTES, "区块应结束在下一个真标题");
}

/// ② 带语言标注的 ```yaml 同样成立（J10）；且 info 串里含反引号的不是开围栏（F2）。
#[test]
fn yaml_info_string_fence_also_hides_comment() {
    let doc = "#### 事项计时\n- [ ] 写代码\n```yaml\n# 备注\nplanner: {}\n```\n- [ ] 第二段\n#### 便利贴\n";
    let body = md_file::body_in_text(doc, TIMERS).expect("应找到标题");
    assert!(body.contains("# 备注"));
    assert!(body.contains("- [ ] 第二段"));
    assert_eq!(end_line_of(doc, TIMERS), NOTES);

    /* F2：反引号围栏的 info 串里不许再有反引号，否则这一行不是开围栏。 */
    let lines = ["```a`b", "# 备注"];
    let fences = md_fence::scan(&lines);
    assert!(!fences.is_inside(1), "含反引号的 info 串不算开围栏");
}

/// ③ `~~~` 围栏同样成立；且 ``` 关不掉 ~~~（F3）。
#[test]
fn tilde_fence_hides_comment_and_is_not_closed_by_backticks() {
    let doc = "#### 事项计时\n- [ ] 写代码\n~~~\n# 备注\n```\n- [ ] 还在围栏里\n~~~\n- [ ] 第二段\n#### 便利贴\n";
    let body = md_file::body_in_text(doc, TIMERS).expect("应找到标题");
    assert!(body.contains("# 备注"));
    assert!(body.contains("- [ ] 还在围栏里"), "反引号关不掉波浪号围栏：{body}");
    assert!(body.contains("- [ ] 第二段"));
    assert_eq!(end_line_of(doc, TIMERS), NOTES);
}

/// ④ 围栏内更短的串不关闭、更长/等长的才关闭（F5，不 toggle 的直接推论）。
#[test]
fn shorter_fence_inside_longer_does_not_close() {
    let doc = "#### 事项计时\n````\n```\n# 备注\n```\n````\n- [ ] 第二段\n#### 便利贴\n";
    let body = md_file::body_in_text(doc, TIMERS).expect("应找到标题");
    assert!(body.contains("# 备注"), "外层没被内层切断：{body}");
    assert!(body.contains("- [ ] 第二段"));
    assert_eq!(end_line_of(doc, TIMERS), NOTES);

    /* 反过来：更长的能关闭更短的。 */
    let doc = "#### 事项计时\n```\n# 备注\n````\n- [ ] 第二段\n#### 便利贴\n";
    assert_eq!(end_line_of(doc, TIMERS), NOTES);
}

/// ⑤ 缩进 4 个空格的 ``` 是缩进代码块，不是围栏（F9）。
#[test]
fn four_space_indented_fence_is_not_a_fence() {
    let doc = "#### 事项计时\n    ```\n# 备注\n    ```\n#### 便利贴\n";
    let body = md_file::body_in_text(doc, TIMERS).expect("应找到标题");
    assert!(!body.contains("# 备注"), "没有围栏，`# 备注` 就是真标题：{body}");
    assert_eq!(end_line_of(doc, TIMERS), "# 备注");
}

// ---------------------------------------------------------------- 洞 2：起点落在别人的围栏里

/// ⑥ 围栏内一行逐字 `#### 事项计时` 不被命中，真标题在它后面时命中的是真那个。
#[test]
fn heading_inside_fence_is_not_the_section_start() {
    let doc = "说明\n```\n#### 事项计时\n```\n真的内容\n#### 事项计时\n- [ ] 真\n";
    let lines: Vec<&str> = doc.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, level) = md_section::find_heading(&lines, &fences, TIMERS).expect("应命中真标题");
    assert_eq!(head_idx, 5, "围栏里那行是示例文本，不是区块起点");
    assert_eq!(level, 4);
    assert_eq!(md_section::count_exact(&lines, &fences, TIMERS), 1, "围栏里那份不算标题");
    assert_eq!(md_file::body_in_text(doc, TIMERS).as_deref(), Some("- [ ] 真"));
}

/// ⑦ 围栏里那行在前、文件里**根本没有**真标题 → `MissingHeading`，补在末尾且不改写围栏。
#[test]
fn heading_only_inside_fence_is_missing_and_appends_at_end() {
    let dir = unique_dir("md-fence-missing");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("2026-11-19.md");
    let before = "顶部说明\n\n```\n#### 事项计时\n```\n";
    std::fs::write(&path, before).unwrap();

    let read = md_file::read_section(&path, TIMERS).unwrap();
    assert!(
        matches!(read.state, SectionState::MissingHeading { .. }),
        "围栏里那行不算标题：{:?}",
        read.state
    );
    assert!(read.issues.is_empty(), "别误报成等级不一致：{:?}", read.issues);

    md_file::write_section(&path, TIMERS, "- [ ] 新").unwrap();
    let after = std::fs::read_to_string(&path).unwrap();
    assert!(after.starts_with(before), "围栏那段必须逐字节不变：\n{after}");
    assert!(
        after.trim_end().ends_with("#### 事项计时\n- [ ] 新"),
        "新的一节应补在末尾：\n{after}"
    );
    assert_eq!(after.matches(TIMERS).count(), 2, "围栏里那行还在，只多了一个真标题");
}

// ---------------------------------------------------------------- 未闭合围栏

/// ⑧ 区块内未闭合 → `Blocked`，且那段被「吞到 EOF」的 body 永远不会被当正文解析。
#[test]
fn unclosed_fence_inside_section_blocks_the_round() {
    let doc = "#### 事项计时\n- [ ] 写代码\n```\n# 备注\n#### 便利贴\n\n表格\n";
    let read = read_text("md-fence-unclosed", doc, TIMERS);
    assert!(
        matches!(read.state, SectionState::Blocked { .. }),
        "应阻断：{:?}",
        read.state
    );
    let issue = read
        .issues
        .iter()
        .find(|issue| matches!(issue, SectionIssue::UnclosedFence { .. }))
        .expect("应报未闭合围栏");
    assert!(issue.blocks());
    assert_eq!(
        issue.text("事项计时"),
        "文件里的代码块没有收尾（缺少结尾的三个反引号），本轮没有读写「事项计时」这一节。"
    );

    /* F7 的语义仍在：未闭合围栏一直延伸到 EOF，所以 `section_end` 就是文件末尾。
       危险的不是这个数字，而是「别把它当 body」——`Blocked` 保证了这一点。 */
    let lines: Vec<&str> = doc.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, level) = md_section::find_heading(&lines, &fences, TIMERS).unwrap();
    assert_eq!(md_section::section_end(&lines, &fences, head_idx, level), lines.len());

    /* 用户补上三个反引号即恢复：body 只到下一个真标题。 */
    let fixed = "#### 事项计时\n- [ ] 写代码\n```\n# 备注\n```\n#### 便利贴\n\n表格\n";
    let read = read_text("md-fence-unclosed-fixed", fixed, TIMERS);
    match read.state {
        SectionState::Present { body, .. } => {
            assert!(body.contains("# 备注"));
            assert!(!body.contains("表格"), "补上收尾后不许把下一节吞进来：{body}");
        }
        other => panic!("补上收尾后应恢复：{other:?}"),
    }
    assert!(read.issues.is_empty(), "{:?}", read.issues);
}

/// ⑨ 未闭合围栏在我方标题**之前** → `MissingHeading`（不阻断）。
#[test]
fn unclosed_fence_before_our_heading_is_not_blocking() {
    let doc = "# 日记\n```\n#### 事项计时\n- [ ] 假\n";
    let read = read_text("md-fence-unclosed-before", doc, TIMERS);
    assert!(
        matches!(read.state, SectionState::MissingHeading { .. }),
        "标题被围栏吞掉，但这不是阻断级：{:?}",
        read.state
    );
    assert!(read.issues.is_empty(), "{:?}", read.issues);
}

/// ⑬ 围栏里的示例不算「同名多份」（J6 的误报守卫）。
///
/// 计数若不看围栏，这份正常文件会每轮报「文件里有 2 个…」，而用户按提示改不掉
/// ——那行本来就在别人的围栏里，不该动。
#[test]
fn fence_example_is_not_counted_as_duplicate_heading() {
    let doc = "说明\n```\n#### 事项计时\n```\n#### 事项计时\n- [ ] 真\n";
    let read = read_text("md-fence-no-fake-duplicate", doc, TIMERS);
    assert!(matches!(read.state, SectionState::Present { .. }), "{:?}", read.state);
    assert!(
        read.issues.is_empty(),
        "围栏里那行不该报「文件里有 2 个…」：{:?}",
        read.issues
    );
    let lines: Vec<&str> = doc.split('\n').collect();
    let fences = md_fence::scan(&lines);
    assert_eq!(md_section::count_exact(&lines, &fences, TIMERS), 1);
    assert_eq!(
        md_section::scan_headings(&lines, &fences, TIMERS).hit,
        Some((4, 4)),
        "定位与计数来自同一趟扫描"
    );
}

// ---------------------------------------------------------------- P1 两处检测

/// ⑩ 同名标题多份：报一句话，但**不阻断**（第 1 个照旧被替换）。
#[test]
fn duplicate_heading_is_reported_but_not_blocking() {
    let doc = "#### 事项计时\n- [ ] 甲\n#### 事项计时\n- [ ] 乙\n#### 便利贴\n";
    let read = read_text("md-fence-duplicate", doc, TIMERS);
    assert!(matches!(read.state, SectionState::Present { .. }), "{:?}", read.state);
    let issue = read
        .issues
        .iter()
        .find(|issue| matches!(issue, SectionIssue::Duplicate { .. }))
        .expect("应报同名多份");
    assert!(!issue.blocks(), "Duplicate 不改变任何字节的归属");
    assert_eq!(
        issue.text("事项计时"),
        "文件里有 2 个「事项计时」标题，请只留一个。"
    );
    assert_eq!(
        md_file::body_in_text(doc, TIMERS).as_deref(),
        Some("- [ ] 甲"),
        "只认第 1 个"
    );
}

/// ⑪ 标题等级被改（`####` → `###`）→ 报红字、不追加第二节。
#[test]
fn mismatched_heading_level_blocks_and_does_not_append() {
    let read = read_text("md-fence-mismatch", "### 事项计时\n- [ ] 甲\n", TIMERS);
    assert!(matches!(read.state, SectionState::Blocked { .. }), "{:?}", read.state);
    let issue = read
        .issues
        .iter()
        .find(|issue| matches!(issue, SectionIssue::Mismatched { .. }))
        .expect("应报等级不一致");
    assert!(issue.blocks());
    assert_eq!(
        issue.text("事项计时"),
        "文件里的「事项计时」标题等级与设置不一致，请改文件或改设置。"
    );
}

/// ⑫ 文件里同时有 `#### 事项计时` 与 `### 事项计时` → 命中前者，**不报错**。
///
/// 挡的是必然发生的误报：用户在日记顶部写目录时会抄一遍标题文本。
#[test]
fn mismatched_is_not_reported_when_exact_heading_exists() {
    let doc = "### 事项计时\n- [ ] 目录抄的一行\n#### 事项计时\n- [ ] 真\n#### 便利贴\n";
    let read = read_text("md-fence-mismatch-ok", doc, TIMERS);
    assert!(matches!(read.state, SectionState::Present { .. }), "{:?}", read.state);
    assert!(read.issues.is_empty(), "见同名就报红会把同步永久堵死：{:?}", read.issues);
}
