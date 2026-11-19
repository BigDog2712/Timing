//! Tolerant AI tag-suggestion parsing and candidate validation.
//!
//! ## 两种标签：候选里的、模型新建的
//!
//! 归一与新建的规则都在 `parser_tags`（候选命中优先、一级白名单、最多两级）；
//! 这里只负责「把模型那坨 JSON 认出形状来」，再把每条标签交给那一层定稿。

use serde_json::Value;

use super::parser_tags::resolve_tags;
use crate::models::ai::{
    AiSuggestResponse, AiSuggestStats, AiTagCandidate, AiTagSuggestion, AiTagTarget,
};

pub(super) fn parse_suggestions(
    raw: &str,
    targets: &[AiTagTarget],
    candidates: &[AiTagCandidate],
    max: u8,
) -> AiSuggestResponse {
    let empty = |dropped| AiSuggestResponse {
        suggestions: Vec::new(),
        stats: AiSuggestStats {
            parsed: 0,
            dropped,
            attempts: 1,
            batches: 1,
            failed_batches: 0,
        },
        created: Vec::new(),
    };
    let Some(value) = extract_json(raw) else {
        return empty(1);
    };
    let list = value
        .get("suggestions")
        .or_else(|| value.get("results"))
        .or_else(|| value.get("data"))
        .or_else(|| value.get("items"))
        .cloned()
        .or_else(|| value.as_array().map(|rows| Value::Array(rows.clone())));
    let rows = match list {
        Some(Value::Array(rows)) => rows,
        Some(_) => return empty(1),
        None => return empty(1),
    };

    let mut suggestions = Vec::new();
    let mut created: Vec<String> = Vec::new();
    let mut parsed = 0usize;
    let mut dropped = 0usize;
    for row in &rows {
        let Some(id) = row
            .get("id")
            .or_else(|| row.get("targetId"))
            .or_else(|| row.get("target"))
            .and_then(value_id)
        else {
            dropped += 1;
            continue;
        };
        let Some(target) = targets.iter().find(|target| target.id == id) else {
            dropped += 1;
            continue;
        };
        let Some(tags) = row
            .get("tags")
            .or_else(|| row.get("labels"))
            .or_else(|| row.get("categories"))
            .and_then(value_tags)
        else {
            dropped += 1;
            continue;
        };
        let (resolved, fresh) = resolve_tags(&tags, candidates, max);
        for tag in fresh {
            if !created.contains(&tag) {
                created.push(tag);
            }
        }
        if resolved.is_empty() && tags.iter().any(|tag| !tag.trim().is_empty()) {
            dropped += 1;
            continue;
        }
        parsed += 1;
        suggestions.push(AiTagSuggestion {
            id: target.id.clone(),
            tags: resolved,
        });
    }
    suggestions.sort_by_key(|suggestion| {
        targets
            .iter()
            .position(|target| target.id == suggestion.id)
            .unwrap_or(usize::MAX)
    });
    AiSuggestResponse {
        stats: AiSuggestStats {
            parsed,
            dropped,
            attempts: 1,
            batches: 1,
            failed_batches: 0,
        },
        suggestions,
        created,
    }
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn value_tags(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Array(values) => Some(
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
        ),
        Value::String(value) => Some(value.split([',', '，', '、']).map(str::to_string).collect()),
        _ => None,
    }
}

fn extract_json(raw: &str) -> Option<Value> {
    let text = strip_wrapping_fence(strip_think(raw).trim());
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        return Some(value);
    }
    for (start, _) in text
        .char_indices()
        .filter(|(_, ch)| *ch == '{' || *ch == '[')
    {
        let Some(end) = balanced_json_end(text, start) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(&text[start..=end]) {
            return Some(value);
        }
    }
    None
}

fn strip_think(text: &str) -> &str {
    let Some(start) = text.find("<think>") else {
        return text;
    };
    let Some(end) = text[start..].find("</think>") else {
        return &text[..start];
    };
    &text[start + end + "</think>".len()..]
}

fn balanced_json_end(text: &str, start: usize) -> Option<usize> {
    let mut stack = Vec::new();
    let mut quoted = false;
    let mut escaped = false;
    for (offset, ch) in text[start..].char_indices() {
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            '{' | '[' => stack.push(ch),
            '}' | ']' => {
                let opener = stack.pop()?;
                if !matches!((opener, ch), ('{', '}') | ('[', ']')) {
                    return None;
                }
                if stack.is_empty() {
                    return Some(start + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn strip_wrapping_fence(text: &str) -> &str {
    if !text.starts_with("```") {
        return text;
    }
    let after = text
        .find('\n')
        .map(|index| &text[index + 1..])
        .unwrap_or("");
    after
        .trim_end()
        .strip_suffix("```")
        .unwrap_or(after)
        .trim_end()
}
