//! Tolerant AI tag-suggestion parsing and candidate validation.

use serde_json::Value;

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
        let resolved = resolve_tags(&tags, candidates, max);
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

fn resolve_tags(tags: &[String], candidates: &[AiTagCandidate], max: u8) -> Vec<String> {
    let mut resolved = Vec::new();
    for text in tags {
        if let Some(key) = resolve_tag(text, candidates) {
            if !resolved.contains(&key) {
                resolved.push(key);
            }
            if resolved.len() == usize::from(max.clamp(1, 8)) {
                break;
            }
        }
    }
    resolved
}

fn resolve_tag(raw: &str, candidates: &[AiTagCandidate]) -> Option<String> {
    let clean = raw.trim().trim_start_matches('#').trim().replace('\\', "/");
    if clean.is_empty() {
        return None;
    }
    if let Some(hit) = candidates.iter().find(|candidate| candidate.key == clean) {
        return Some(hit.key.clone());
    }
    let lowered = clean.to_lowercase();
    candidates
        .iter()
        .find(|candidate| {
            candidate
                .label
                .trim()
                .trim_start_matches('#')
                .trim()
                .to_lowercase()
                == lowered
        })
        .map(|candidate| candidate.key.clone())
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
