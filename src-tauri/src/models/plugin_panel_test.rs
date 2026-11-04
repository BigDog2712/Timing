//! `models::plugin_panel` 的校验测试（拆出以守住单文件 ≤300 行）。

use super::*;

fn text(value: &str) -> PanelBlock {
    PanelBlock::Text {
        text: value.into(),
    }
}

fn stats(source: &str) -> PanelBlock {
    PanelBlock::Stats {
        source: source.into(),
        label: "本周".into(),
        params: QueryParams {
            days: Some(7),
            limit: None,
        },
    }
}

fn button(action: &str) -> PanelAction {
    PanelAction {
        label: "点我".into(),
        action: action.into(),
        params: ActionParams {
            item: Some("摸鱼".into()),
            title: Some("喝水".into()),
            content: Some("记一句".into()),
        },
    }
}

fn panel(id: &str, blocks: Vec<PanelBlock>) -> Panel {
    Panel {
        id: id.into(),
        title: "测试面板".into(),
        width: None,
        height: None,
        blocks,
    }
}

#[test]
fn a_well_formed_panel_passes() {
    let panels = vec![panel(
        "weekly",
        vec![
            text("按事项统计本周投入。"),
            stats("records.byItem"),
            PanelBlock::Actions {
                items: vec![button("timer.start")],
            },
        ],
    )];
    assert!(validate_panels(&panels).is_ok());
}

#[test]
fn unknown_source_is_rejected_with_the_whitelist() {
    let err = validate_panels(&[panel("a", vec![stats("records.everything")])]).unwrap_err();
    assert!(err.contains("未知数据源"), "{err}");
    /* 报错要带上可用清单，否则作者只能去翻文档 */
    assert!(err.contains("records.byItem"), "{err}");
}

#[test]
fn unknown_action_is_rejected() {
    let err = validate_panels(&[panel(
        "a",
        vec![PanelBlock::Actions {
            items: vec![button("shell.run")],
        }],
    )])
    .unwrap_err();
    assert!(err.contains("未知动作"), "{err}");
}

#[test]
fn an_action_missing_its_required_param_fails_at_load_time() {
    /* 参数缺失必须在加载时拒绝：点下去才失败的按钮，用户只会以为插件坏了 */
    let mut item = button("timer.start");
    item.params.item = Some("   ".into());
    let err = validate_panels(&[panel(
        "a",
        vec![PanelBlock::Actions { items: vec![item] }],
    )])
    .unwrap_err();
    assert!(err.contains("timer.start 需要 params.item"), "{err}");
}

#[test]
fn duplicate_panel_ids_are_rejected() {
    let err = validate_panels(&[panel("dup", vec![text("一")]), panel("dup", vec![text("二")])])
        .unwrap_err();
    assert!(err.contains("重复"), "{err}");
}

#[test]
fn panel_ids_follow_the_same_rule_as_plugin_ids() {
    let err = validate_panels(&[panel("Weekly", vec![text("大写不行")])]).unwrap_err();
    assert!(err.contains("小写字母"), "{err}");
}

#[test]
fn size_and_block_count_are_bounded() {
    let mut wide = panel("a", vec![text("x")]);
    wide.width = Some(900.0);
    assert!(validate_panels(&[wide]).is_err());

    let many = vec![text("x"); MAX_BLOCKS + 1];
    assert!(validate_panels(&[panel("b", many)]).is_err());
}

#[test]
fn an_empty_panel_is_rejected() {
    let err = validate_panels(&[panel("empty", Vec::new())]).unwrap_err();
    assert!(err.contains("至少"), "{err}");
}

#[test]
fn query_params_are_range_checked() {
    let mut block = stats("records.byItem");
    if let PanelBlock::Stats { params, .. } = &mut block {
        params.days = Some(0);
    }
    assert!(validate_panels(&[panel("a", vec![block])]).is_err());
}

#[test]
fn defaults_fill_in_a_sane_window_size() {
    let p = panel("a", vec![text("x")]);
    assert_eq!(p.width_or_default(), 320.0);
    assert_eq!(p.height_or_default(), 460.0);
}

#[test]
fn an_unknown_block_type_fails_to_deserialize() {
    /* 块类型是封闭枚举：写 `table` 这类没实现的形态必须解析失败（并因此被
       `plugin_fs` 拒载），而不是安安静静渲染成一片空白。 */
    let raw = r#"{"id":"a","title":"t","blocks":[{"type":"table","rows":[]}]}"#;
    assert!(serde_json::from_str::<Panel>(raw).is_err());
}

#[test]
fn text_blocks_are_length_capped() {
    let long = "啊".repeat(MAX_TEXT_CHARS + 1);
    assert!(validate_panels(&[panel("a", vec![text(&long)])]).is_err());
}
