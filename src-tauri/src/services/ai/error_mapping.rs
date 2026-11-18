//! AI transport error classification, retry policy, and safe user detail.

use async_openai::error::OpenAIError;
use reqwest::StatusCode;
use std::time::Duration;

use crate::error::{AppError, ErrorCode};

const MAX_ERROR_DETAIL_CHARS: usize = 200;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(10);

pub(super) fn map_openai_error(err: &OpenAIError, api_key: &str) -> AppError {
    let (code, detail) = match err {
        OpenAIError::ApiError(response) => {
            let code = match response.status_code {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ErrorCode::AiAuth,
                StatusCode::TOO_MANY_REQUESTS => ErrorCode::AiRateLimited,
                StatusCode::BAD_REQUEST => ErrorCode::AiBadRequest,
                status if status.is_server_error() => ErrorCode::AiUpstream,
                _ => ErrorCode::AiBadRequest,
            };
            (code, response.api_error.message.as_str())
        }
        OpenAIError::Reqwest(error) if error.is_timeout() => (ErrorCode::AiTimeout, "请求超时"),
        OpenAIError::Reqwest(error) if error.is_connect() || error.is_request() => {
            (ErrorCode::AiNetwork, "网络连接失败")
        }
        OpenAIError::Reqwest(_) => (ErrorCode::AiUpstream, "AI 服务请求失败"),
        OpenAIError::JSONDeserialize(_, _) => (ErrorCode::AiUpstream, "AI 服务响应格式异常"),
        OpenAIError::InvalidArgument(_) => (ErrorCode::AiBadRequest, "AI 请求参数无效"),
        OpenAIError::StreamError(_) => (ErrorCode::AiUpstream, "AI 服务响应异常"),
        OpenAIError::FileSaveError(_) | OpenAIError::FileReadError(_) => {
            (ErrorCode::AiUpstream, "AI 服务请求失败")
        }
    };
    let detail = sanitize_detail(detail, api_key);
    let message = if detail.is_empty() {
        friendly_message(code).to_string()
    } else {
        format!("{}（详情：{detail}）", friendly_message(code))
    };
    AppError::new(code, message)
}

#[cfg(test)]
fn parse_retry_after(value: &str) -> Option<Duration> {
    let seconds = value.trim().parse::<u64>().ok()?;
    Some(Duration::from_secs(seconds).min(MAX_RETRY_AFTER))
}

pub(super) fn retry_delay(
    retry_after: Option<Duration>,
    fallback: Duration,
    remaining_budget: Duration,
) -> Duration {
    retry_after
        .unwrap_or(fallback)
        .min(MAX_RETRY_AFTER)
        .min(remaining_budget)
}

pub(super) fn is_retryable(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::AiNetwork
            | ErrorCode::AiTimeout
            | ErrorCode::AiRateLimited
            | ErrorCode::AiUpstream
    )
}

fn friendly_message(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::AiAuth => "API 密钥无效或无权限，请到 设置 → AI 检查密钥与模型",
        ErrorCode::AiRateLimited => "请求太频繁，请稍后再试",
        ErrorCode::AiNetwork => "无法连接 AI 服务，请检查网络后重试",
        ErrorCode::AiTimeout => "AI 请求超时，请稍后重试",
        ErrorCode::AiUpstream => "AI 服务暂时不可用，请稍后重试",
        ErrorCode::AiBadRequest => "AI 请求不被服务商接受，请检查模型与参数",
        _ => "AI 请求失败",
    }
}

fn sanitize_detail(detail: &str, api_key: &str) -> String {
    let mut safe = detail.replace(api_key, "[已隐藏]");
    safe = replace_sensitive_value(&safe, "Bearer ", "[已隐藏]");
    safe = replace_sensitive_value(&safe, "api_key=", "[已隐藏]");
    safe = redact_sk_tokens(&safe);
    safe = safe.split_whitespace().collect::<Vec<_>>().join(" ");
    safe.chars().take(MAX_ERROR_DETAIL_CHARS).collect()
}

fn redact_sk_tokens(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(index) = remaining.find("sk-") {
        output.push_str(&remaining[..index]);
        let token = &remaining[index..];
        let token_end = token.find(char::is_whitespace).unwrap_or(token.len());
        output.push_str("[已隐藏]");
        remaining = &token[token_end..];
    }
    output.push_str(remaining);
    output
}

fn replace_sensitive_value(text: &str, marker: &str, replacement: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(end_marker) = remaining.char_indices().find_map(|(index, _)| {
        let end = index.checked_add(marker.len())?;
        remaining
            .get(index..end)
            .filter(|candidate| candidate.eq_ignore_ascii_case(marker))
            .map(|_| end)
    }) {
        output.push_str(&remaining[..end_marker]);
        output.push_str(replacement);
        let rest = &remaining[end_marker..];
        let value_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        remaining = &rest[value_end..];
    }
    output.push_str(remaining);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn retry_policy_only_allows_transient_errors() {
        assert!(is_retryable(ErrorCode::AiNetwork));
        assert!(is_retryable(ErrorCode::AiTimeout));
        assert!(is_retryable(ErrorCode::AiRateLimited));
        assert!(is_retryable(ErrorCode::AiUpstream));
        assert!(!is_retryable(ErrorCode::AiAuth));
        assert!(!is_retryable(ErrorCode::AiBadRequest));
        assert!(!is_retryable(ErrorCode::AiParse));
        assert_eq!(super::super::client::MAX_RETRIES, 2);
        assert_eq!(
            super::super::client::RETRY_DELAYS,
            [Duration::from_secs(1), Duration::from_secs(2)]
        );
    }

    #[test]
    fn retry_after_is_parsed_capped_and_budget_limited() {
        assert_eq!(parse_retry_after("3"), Some(Duration::from_secs(3)));
        assert_eq!(parse_retry_after("99"), Some(Duration::from_secs(10)));
        assert_eq!(parse_retry_after("invalid"), None);
        assert_eq!(
            retry_delay(
                Some(Duration::from_secs(8)),
                Duration::from_secs(1),
                Duration::from_secs(4)
            ),
            Duration::from_secs(4)
        );
        assert_eq!(
            retry_delay(
                Some(Duration::from_secs(30)),
                Duration::from_secs(1),
                Duration::from_secs(20)
            ),
            Duration::from_secs(10)
        );
        assert_eq!(
            retry_delay(None, Duration::from_secs(2), Duration::from_secs(5)),
            Duration::from_secs(2)
        );
    }

    #[test]
    fn error_details_redact_credentials_and_are_bounded() {
        let safe = sanitize_detail(
            "bad sk-secret Bearer token-value api_key=other-secret",
            "sk-secret",
        );
        assert!(!safe.contains("sk-secret"));
        assert!(!sanitize_detail("response sk-another-secret", "key").contains("sk-another-secret"));
        assert!(!safe.contains("token-value"));
        assert!(!safe.contains("other-secret"));
        assert!(safe.contains("[已隐藏]"));
        assert!(sanitize_detail(&"x".repeat(300), "key").chars().count() <= MAX_ERROR_DETAIL_CHARS);
    }
}
