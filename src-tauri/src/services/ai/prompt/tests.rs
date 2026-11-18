use super::*;
use crate::models::ai::{AiTagCandidate, AiTagMode, AiTagSuggestion, AiTagTarget};

fn candidates() -> Vec<AiTagCandidate> {
    vec![
        AiTagCandidate {
            key: "study".into(),
            label: "学习".into(),
        },
        AiTagCandidate {
            key: "custom:category_a".into(),
            label: "学习/考公".into(),
        },
        AiTagCandidate {
            key: "fun".into(),
            label: "娱乐".into(),
        },
    ]
}

fn targets() -> Vec<AiTagTarget> {
    vec![
        AiTagTarget {
            id: "3".into(),
            text: "行测刷题".into(),
        },
        AiTagTarget {
            id: "4".into(),
            text: "看剧".into(),
        },
        AiTagTarget {
            id: "5".into(),
            text: "发呆".into(),
        },
    ]
}

#[test]
fn suggestions_are_mapped_to_keys_and_unknown_tags_dropped() {
    let raw = r##"好的：
```json
{"suggestions":[{"id":3,"tags":["学习/考公","编出来的标签","#娱乐"]},
{"id":"4","tags":["娱乐","娱乐"]},{"id":"5","tags":[]}]}
```"##;
    let parsed = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(parsed.suggestions.len(), 3);
    assert_eq!(parsed.suggestions[0].id, "3");
    assert_eq!(parsed.suggestions[0].tags, vec!["custom:category_a", "fun"]);
    assert_eq!(parsed.suggestions[1].tags, vec!["fun"]);
    assert_eq!(parsed.suggestions[2].id, "5");
    assert!(parsed.suggestions[2].tags.is_empty());
    assert_eq!(parsed.stats.parsed, 3);
    assert_eq!(parsed.stats.dropped, 0);
}

#[test]
fn garbage_or_wrong_shape_returns_empty() {
    assert!(parse_suggestions("我不确定", &targets(), &candidates(), 3)
        .suggestions
        .is_empty());
    assert!(
        parse_suggestions("{\"foo\":1}", &targets(), &candidates(), 3)
            .suggestions
            .is_empty()
    );
}

#[test]
fn think_fence_balanced_json_and_aliases_are_supported() {
    let raw = r#"<think>reasoning {not json}</think>模型结果如下：```json
{"results":[{"targetId":3,"categories":"学习，娱乐"}]}
```"#;
    let parsed = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(parsed.suggestions.len(), 1);
    assert_eq!(parsed.suggestions[0].id, "3");
    assert_eq!(parsed.suggestions[0].tags, vec!["study", "fun"]);
}

#[test]
fn all_invalid_rows_are_counted_as_dropped() {
    let parsed = parse_suggestions(
        r#"{"suggestions":[{"id":"3","tags":["unknown"]},{"id":"missing","tags":["学习"]}]}"#,
        &targets(),
        &candidates(),
        3,
    );
    assert!(parsed.suggestions.is_empty());
    assert_eq!(parsed.stats.parsed, 0);
    assert_eq!(parsed.stats.dropped, 2);
}

#[test]
fn empty_suggestions_are_valid_and_have_zero_dropped_rows() {
    let parsed = parse_suggestions(r#"{"suggestions":[]}"#, &targets(), &candidates(), 3);
    assert!(parsed.suggestions.is_empty());
    assert_eq!(parsed.stats.parsed, 0);
    assert_eq!(parsed.stats.dropped, 0);
}

#[test]
fn malformed_output_counts_one_unparseable_response_not_all_targets() {
    let parsed = parse_suggestions("not valid JSON", &targets(), &candidates(), 3);
    assert_eq!(parsed.stats.parsed, 0);
    assert_eq!(parsed.stats.dropped, 1);
}

#[test]
fn markdown_headings_are_demoted_and_fences_stripped() {
    let raw = "```markdown\n# 今日汇总\n\n- 写代码 2h\n## 明细\n- 刷剧 1h\n```";
    let text = sanitize_markdown(raw);
    assert!(!text.contains('#'));
    assert!(text.contains("**今日汇总**"));
    assert!(text.contains("- 写代码 2h"));
}

#[test]
fn prompt_never_contains_candidate_keys() {
    let request = AiSuggestRequest {
        mode: AiTagMode::Item,
        targets: targets(),
        candidates: candidates(),
    };
    let prompt = suggest_prompt(&request, 3);
    assert!(prompt.contains("学习/考公"));
    assert!(!prompt.contains("custom:category_a"));
}

#[test]
fn suggestion_type_stays_serializable() {
    let suggestion = AiTagSuggestion {
        id: "3".into(),
        tags: vec!["study".into()],
    };
    assert_eq!(suggestion.id, "3");
}
