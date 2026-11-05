//! `infra::md_file` 的单元测试（拆出以守住单文件 ≤300 行）。

use chrono::NaiveDate;

use super::*;

const SAMPLE: &str = "# 2026-10-20 星期二\n\n### 计划完成度\n\n- 手写内容\n\n#### 事项汇总\n\n- 汇总行\n\n#### 事项计时\n\n- [ ] 旧事项\n  ```yaml\n  planner:\n    log:\n      - start: 2026-10-20 09:00:00\n        end: 2026-10-20 09:10:00\n  ```\n\n#### 便利贴\n\n| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| 2026-10-20 09:00:00 | 生活 | 买牛奶 <!-- tb-note:3 --> |\n";

#[test]
fn extracts_only_target_section() {
    let body = body_in_text(SAMPLE, "#### 事项计时").expect("应找到标题");
    assert!(body.contains("- [ ] 旧事项"));
    assert!(!body.contains("买牛奶"), "不能把下一个标题的内容算进来");
    assert!(!body.contains("手写内容"));
}

#[test]
fn replaces_target_section_and_keeps_the_rest() {
    let updated = replace_in_text(SAMPLE, "#### 事项计时", "- [ ] 新事项");
    assert!(updated.contains("- 手写内容"), "前文必须保留");
    assert!(updated.contains("- 汇总行"), "上一节必须保留");
    assert!(updated.contains("买牛奶"), "下一节必须保留");
    assert!(updated.contains("新事项"));
    assert!(!updated.contains("旧事项"));
}

#[test]
fn appends_when_heading_missing() {
    let updated = append_section("# 日记\n\n正文", "#### 便利贴", "| 表头 |");
    assert!(updated.ends_with("#### 便利贴\n| 表头 |\n"));
    assert!(updated.contains("# 日记"));
}

#[test]
fn section_ends_at_same_level_heading() {
    let text = "#### A\n\nbody\n\n#### B\n\nother\n";
    assert_eq!(body_in_text(text, "#### A").as_deref(), Some("body"));
    assert_eq!(body_in_text(text, "#### B").as_deref(), Some("other"));
}

#[test]
fn deeper_heading_stays_inside_section() {
    let text = "#### A\n\n##### 子标题\n\nbody\n\n#### B\n";
    let body = body_in_text(text, "#### A").unwrap();
    assert!(body.contains("子标题"));
    assert!(body.contains("body"));
}

#[test]
fn resolves_tokens_and_env() {
    let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    let path = resolve_path("C:\\vault", "Diary/{yyyy}/{MM}/{date}.md", date);
    assert!(path.ends_with("Diary\\2026\\10\\2026-10-20.md"));
}

#[test]
fn expands_unknown_env_verbatim() {
    assert_eq!(
        expand_env("%TIMING_NO_SUCH_VAR%\\x"),
        "%TIMING_NO_SUCH_VAR%\\x"
    );
}
