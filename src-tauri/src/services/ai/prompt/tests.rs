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

#[test]
fn new_tags_are_created_only_under_the_six_top_levels() {
    /* 候选里没有「燕云」，模型新建：合规（父/子、一级在白名单里）→ 保留；
       同时给一条一级不合规的（`游戏/燕云`）与一条三级的，两者都必须被丢掉。 */
    let raw = r##"{"suggestions":[
        {"id":"4","tags":["娱乐/燕云","游戏/燕云","娱乐/燕云/开荒"]}
    ]}"##;
    let response = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(response.suggestions.len(), 1);
    assert_eq!(response.suggestions[0].tags, vec!["娱乐/燕云".to_string()]);
    assert_eq!(response.created, vec!["娱乐/燕云".to_string()]);
}

#[test]
fn tool_is_a_top_level_so_tool_sub_tags_are_accepted() {
    /* [P0-9 · 2026-11-20] 白名单加了「工具」：`工具/下载` 必须**被保留**（以前会被
       `sanitize_new_tag` 整条丢掉，用户看到的是"AI 就是不肯给下载器打工具"）。
       变异靶点：把 `TAG_TOP_LEVELS` 里的 `"工具"` 删掉 → 本条红（created 变空）。 */
    assert!(
        TAG_TOP_LEVELS.contains(&"工具"),
        "「工具」必须在一级白名单里，否则 P0-9 整条失效"
    );
    let raw = r##"{"suggestions":[{"id":"4","tags":["工具","工具/下载","工具/系统"]}]}"##;
    let response = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(
        response.suggestions[0].tags,
        vec![
            "工具".to_string(),
            "工具/下载".to_string(),
            "工具/系统".to_string()
        ]
    );
    assert_eq!(
        response.created,
        vec![
            "工具".to_string(),
            "工具/下载".to_string(),
            "工具/系统".to_string()
        ]
    );
}

#[test]
fn system_prompt_tells_the_model_to_read_the_apps_purpose_not_only_its_name() {
    /* [P0-10] 规则升级的两条硬要求，缺一条结果就会退化成"只看名字猜"：
       ① 依据里必须有**用途**（名称 / exe / 简介三样一起读）；
       ② 多功能应用允许**多个**一级标签（否则 Chrome 只会被判成一类）。
       这条钉的是**提示词文本**，不是解析 —— 解析侧对多标签本来就无上限。 */
    assert!(
        SYSTEM_SUGGEST.contains("用途"),
        "提示词必须要求看软件的用途，而不是只看名字"
    );
    assert!(
        SYSTEM_SUGGEST.contains("多个") || SYSTEM_SUGGEST.contains("多标签"),
        "提示词必须允许一个应用给多个一级标签"
    );
    assert!(
        SYSTEM_SUGGEST.contains("工具") && SYSTEM_SUGGEST.contains("游戏"),
        "工具类与游戏类的判定口径必须写在提示词里（IDM / 燕云那两个样例）"
    );
}

#[test]
fn system_prompt_keeps_the_two_level_no_hash_no_space_rule() {
    /* 「最多两级 + 父/子 + 不写 #、不带空格」是新建标签的底线：提示词里少了这句，
       模型就会回 `娱乐/燕云/开荒`（三级）或 `#娱乐`，落库前虽然还有一层兜底，
       但兜底一丢就等于整批建议白跑。 */
    assert!(SYSTEM_SUGGEST.contains("父/子"));
    assert!(SYSTEM_SUGGEST.contains("最多两级"));
    assert!(SYSTEM_SUGGEST.contains('#'));
    assert!(SYSTEM_SUGGEST.contains("不写空格"));
    /* 事项侧的自动建标（吃饭 → 生活/吃饭）也必须还在 */
    assert!(SYSTEM_SUGGEST.contains("生活/吃饭"));
    assert!(SYSTEM_SUGGEST.contains("工作/周报"));
}

#[test]
fn hyphenated_parent_child_is_read_as_a_path() {
    /* 用户口径的写法就是「父类-子类」（娱乐-燕云）。只在**前半段正好是一级标签**时
       才转成路径：`AI-编程` 这种本来就想带连字符的名字不许被改写。 */
    let raw = r##"{"suggestions":[{"id":"4","tags":["娱乐-燕云","AI-编程"]}]}"##;
    let response = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(response.suggestions[0].tags, vec!["娱乐/燕云".to_string()]);
    assert_eq!(response.created, vec!["娱乐/燕云".to_string()]);
}

#[test]
fn existing_tags_win_over_new_ones_and_are_not_reported_as_created() {
    /* `娱乐` 已在候选里：按候选原样回，不进 created；重复的同一个意思只留一条。 */
    let raw = r##"{"suggestions":[{"id":"4","tags":["娱乐","娱乐","#娱乐"]}]}"##;
    let response = parse_suggestions(raw, &targets(), &candidates(), 3);
    assert_eq!(response.suggestions[0].tags, vec!["fun".to_string()]);
    assert!(response.created.is_empty());
}

#[test]
fn empty_or_control_only_tags_never_become_new_tags() {
    let raw = r##"{"suggestions":[{"id":"4","tags":["","   ","#","学习/"]}]}"##;
    let response = parse_suggestions(raw, &targets(), &candidates(), 3);
    let tags = &response.suggestions.first().map(|row| row.tags.clone()).unwrap_or_default();
    /* `学习/` 归一成 `学习`，而 `学习` 在候选里（key=study），所以它是匹配不是新建 */
    assert_eq!(tags, &vec!["study".to_string()]);
    assert!(response.created.is_empty());
}
