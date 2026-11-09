//! `tools.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use serde_json::json;

fn valid_input(target: serde_json::Value) -> serde_json::Value {
    json!({
        "target": target,
        "labelSnapshot": "Target",
        "limitMs": 60_000,
        "message": ""
    })
}

#[test]
fn activity_target_dto_rejects_mixed_and_unknown_fields() {
    assert!(
        serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
            "kind": "category",
            "categoryId": "development",
            "appName": "Editor"
        })))
        .is_err()
    );
    assert!(
        serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
            "kind": "unknown",
            "value": "x"
        })))
        .is_err()
    );
}

#[test]
fn activity_target_dto_normalizes_and_bounds_input() {
    let input = serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
        "kind": "web",
        "normalizedDomain": " Example.COM. "
    })))
    .unwrap();
    let request = CreateActivityReminderRuleRequest::try_from(input).unwrap();
    assert_eq!(
        request.target,
        ActivityReminderTarget::Web {
            normalized_domain: "example.com".to_string()
        }
    );

    let oversized = "x".repeat(501);
    let input = serde_json::from_value::<CreateActivityReminderRuleDto>(json!({
        "target": { "kind": "app", "appName": "Editor", "exeName": "EDITOR.EXE" },
        "labelSnapshot": "Editor",
        "limitMs": 86_400_001_i64,
        "message": oversized
    }))
    .unwrap();
    assert!(CreateActivityReminderRuleRequest::try_from(input).is_err());
}
