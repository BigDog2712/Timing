//! 标签建议入口：配置闸 → 裁剪载荷 → 顺序分批对话 → 解析成可写库的键。
//!
//! 候选表由前端给（分析窗已有一份目录聚合，后端不重新拼一套），后端只负责
//! 「提示词 + 校验」。这样新增内置分类时不用同步改 Rust。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::models::ai::{AiSuggestRequest, AiSuggestResponse, AiTagMode};

use super::{client, config, prompt};

/// 单次请求的上限：再多就该分批，否则 token 与等待时间都不可控。
const MAX_TARGETS: usize = 40;
const MAX_CANDIDATES: usize = 200;
/// 单条文本的上限：事项名 / 应用名与标签路径都可能被用户写成超长串，
/// 不裁剪就等于让一次点击决定 token 账单。
const MAX_TARGET_TEXT: usize = 200;
const MAX_CANDIDATE_LABEL: usize = 120;

pub async fn suggest(pool: &SqlitePool, request: AiSuggestRequest) -> AppResult<AiSuggestResponse> {
    let (config, key) = config::require_ready(pool).await?;
    let switch_on = match request.mode {
        AiTagMode::Item => config.item_tags_enabled,
        AiTagMode::App => config.app_tags_enabled,
    };
    if !switch_on {
        return Err(AppError::new(
            ErrorCode::AiDisabled,
            "AI 标签建议已关闭：请到「设置 → AI」打开对应入口",
        ));
    }
    if request.candidates.len() > MAX_CANDIDATES {
        return Err(AppError::new(
            ErrorCode::AiBadRequest,
            "候选标签超过 200 个上限，请缩小标签目录",
        ));
    }
    let request = prepare(request);
    if request.targets.is_empty() || request.candidates.is_empty() {
        return Ok(prompt::parse_suggestions(
            "{\"suggestions\":[]}",
            &request.targets,
            &request.candidates,
            config.max_tags_per_target,
        ));
    }
    let chat = client::build_suggest(&config, &key)?;
    suggest_in_batches(&chat, &request, config.max_tags_per_target).await
}

/// Process target batches in input order while keeping successful batches when another
/// batch fails. The response shape stays unchanged; failure counts are exposed in stats.
async fn suggest_in_batches(
    chat: &client::ChatClient,
    request: &AiSuggestRequest,
    max_tags_per_target: u8,
) -> AppResult<AiSuggestResponse> {
    let batch_count = request.targets.chunks(MAX_TARGETS).count();
    let mut merged = AiSuggestResponse {
        suggestions: Vec::new(),
        stats: Default::default(),
        created: Vec::new(),
    };
    let mut first_error: Option<(ErrorCode, String)> = None;

    for targets in request.targets.chunks(MAX_TARGETS) {
        let batch_request = AiSuggestRequest {
            mode: request.mode,
            targets: targets.to_vec(),
            candidates: request.candidates.clone(),
        };
        match suggest_batch(chat, &batch_request, max_tags_per_target).await {
            Ok(response) => merge_batch_response(&mut merged, response),
            Err(error) => {
                merge_batch_failure(&mut merged, targets.len());
                if first_error.is_none() {
                    first_error = Some((error.code, error.message));
                }
            }
        }
    }

    merged.stats.batches = batch_count;
    if merged.stats.failed_batches == batch_count {
        let (code, message) =
            first_error.unwrap_or((ErrorCode::AiUpstream, "AI 标签建议分批失败".to_string()));
        return Err(AppError::new(
            code,
            format!("AI 标签建议全部批次失败（{batch_count} 批）：{message}"),
        ));
    }
    merged.suggestions.sort_by_key(|suggestion| {
        request
            .targets
            .iter()
            .position(|target| target.id == suggestion.id)
            .unwrap_or(usize::MAX)
    });
    Ok(merged)
}

fn merge_batch_response(merged: &mut AiSuggestResponse, response: AiSuggestResponse) {
    merged.stats.parsed += response.stats.parsed;
    merged.stats.dropped += response.stats.dropped;
    merged.stats.attempts += response.stats.attempts;
    merged.suggestions.extend(response.suggestions);
}

fn merge_batch_failure(merged: &mut AiSuggestResponse, target_count: usize) {
    merged.stats.failed_batches += 1;
    // A failed batch has no parse stats, so count its targets as dropped.
    merged.stats.dropped += target_count;
}

async fn suggest_batch(
    chat: &client::ChatClient,
    request: &AiSuggestRequest,
    max_tags_per_target: u8,
) -> AppResult<AiSuggestResponse> {
    let user = prompt::suggest_prompt(request, max_tags_per_target);
    let raw = chat.chat(prompt::SYSTEM_SUGGEST, &user).await?;
    let mut response = prompt::parse_suggestions(
        &raw,
        &request.targets,
        &request.candidates,
        max_tags_per_target,
    );
    if response.suggestions.is_empty() && response.stats.dropped > 0 {
        let correction =
            format!("上一次输出无法解析。请只输出符合要求的 JSON，不要解释。原始请求：{user}");
        let corrected = chat.chat(prompt::SYSTEM_SUGGEST, &correction).await?;
        response = prompt::parse_suggestions(
            &corrected,
            &request.targets,
            &request.candidates,
            max_tags_per_target,
        );
        response.stats.attempts = 2;
    }
    if response.suggestions.is_empty() && response.stats.dropped > 0 {
        return Err(AppError::new(
            ErrorCode::AiParse,
            "AI 返回内容无法解析，请重试",
        ));
    }
    Ok(response)
}

/// 裁剪后的文本同时喂给提示词与解析层：两边看到的 label 必须一致，
/// 否则模型照着裁剪后的 label 回传，解析却拿原始长串去比，全部判为未知标签。
fn prepare(mut request: AiSuggestRequest) -> AiSuggestRequest {
    request.candidates.truncate(MAX_CANDIDATES);
    for target in &mut request.targets {
        target.text = cap_chars(&target.text, MAX_TARGET_TEXT);
    }
    for candidate in &mut request.candidates {
        candidate.label = cap_chars(&candidate.label, MAX_CANDIDATE_LABEL);
    }
    request
}

fn cap_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai::AiTagTarget;

    #[test]
    fn cap_chars_counts_chars_not_bytes() {
        let long = "学".repeat(MAX_TARGET_TEXT + 50);
        assert_eq!(
            cap_chars(&long, MAX_TARGET_TEXT).chars().count(),
            MAX_TARGET_TEXT
        );
        assert_eq!(cap_chars("短", MAX_TARGET_TEXT), "短");
    }

    #[test]
    fn prepare_caps_candidate_rows_but_keeps_targets_for_batching() {
        let request = AiSuggestRequest {
            mode: AiTagMode::Item,
            targets: (0..MAX_TARGETS + 1)
                .map(|index| AiTagTarget {
                    id: index.to_string(),
                    text: "长".repeat(5000),
                })
                .collect(),
            candidates: (0..MAX_CANDIDATES + 10)
                .map(|index| crate::models::ai::AiTagCandidate {
                    key: format!("k{index}"),
                    label: "标".repeat(5000),
                })
                .collect(),
        };
        let bounded = prepare(request);
        assert_eq!(bounded.targets.len(), MAX_TARGETS + 1);
        assert_eq!(bounded.candidates.len(), MAX_CANDIDATES);
        assert_eq!(bounded.targets[0].text.chars().count(), MAX_TARGET_TEXT);
        assert_eq!(
            bounded.candidates[0].label.chars().count(),
            MAX_CANDIDATE_LABEL
        );
        assert_eq!(bounded.targets.chunks(MAX_TARGETS).count(), 2);
    }

    #[test]
    fn merging_batches_keeps_successes_and_reports_failure_count() {
        let mut merged = AiSuggestResponse {
            suggestions: Vec::new(),
            stats: Default::default(),
            created: Vec::new(),
        };
        merge_batch_response(
            &mut merged,
            AiSuggestResponse {
                suggestions: vec![crate::models::ai::AiTagSuggestion {
                    id: "a".to_string(),
                    tags: vec!["study".to_string()],
                }],
                stats: crate::models::ai::AiSuggestStats {
                    parsed: 1,
                    dropped: 0,
                    attempts: 1,
                    batches: 1,
                    failed_batches: 0,
                },
                created: Vec::new(),
            },
        );
        merge_batch_failure(&mut merged, 1);
        assert_eq!(merged.suggestions.len(), 1);
        assert_eq!(merged.suggestions[0].id, "a");
        assert_eq!(merged.stats.parsed, 1);
        assert_eq!(merged.stats.dropped, 1);
        assert_eq!(merged.stats.failed_batches, 1);
    }

    #[test]
    fn target_batches_preserve_order_and_have_at_most_forty_rows() {
        let targets: Vec<AiTagTarget> = (0..81)
            .map(|index| AiTagTarget {
                id: index.to_string(),
                text: format!("target-{index}"),
            })
            .collect();
        let batches: Vec<Vec<String>> = targets
            .chunks(MAX_TARGETS)
            .map(|batch| batch.iter().map(|target| target.id.clone()).collect())
            .collect();
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0].len(), 40);
        assert_eq!(batches[1].len(), 40);
        assert_eq!(batches[2], vec!["80"]);
        assert_eq!(
            batches.into_iter().flatten().collect::<Vec<_>>(),
            (0..81).map(|index| index.to_string()).collect::<Vec<_>>()
        );
    }
}
