//! AI transport error classification, retry policy, and safe user detail.

use async_openai::error::OpenAIError;
use reqwest::StatusCode;
use std::time::Duration;

use crate::error::{AppError, ErrorCode};

const MAX_ERROR_DETAIL_CHARS: usize = 200;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(10);
/// 型号名的形状约束：只收 ASCII 标识符，超长的当正文噪音丢掉。
const MAX_MODEL_NAME_CHARS: usize = 64;
/// 服务商可能一次列几十个型号，提示语里只带前几个，再多就该去设置页看目录。
const MAX_SUPPORTED_MODELS: usize = 6;

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
    /* 模型名被拒单独说：通用文案「请检查模型与参数」把该改什么交给了用户猜，
       而这条错误恰恰是唯一能当场给出正确型号的一条。**翻译成功就不再附原文**——
       原句里除了这句翻译已经说完的内容，只剩 request_id，重复一遍只是噪音。 */
    let message = match model_rejection(&detail) {
        Some(hint) => hint,
        None if detail.is_empty() => friendly_message(code).to_string(),
        None => format!("{}（详情：{detail}）", friendly_message(code)),
    };
    AppError::new(code, message)
}

/// 模型名不被服务商接受时，把英文原文翻成「哪个名字不认 / 哪些能用 / 去哪儿改」。
///
/// 服务商把「这个型号我不认识」也塞进 400 正文，和参数错误共用 `AI_BAD_REQUEST`；
/// 原文是英文自由文本，直接转述等于让用户照着「检查模型与参数」去猜。这里只在
/// **能确认是模型命名问题**时才改写——措辞够窄，宁可退回通用文案，也不能让
/// 「temperature 超范围」被误报成「模型名不对」，那是把用户往错的方向推。
fn model_rejection(detail: &str) -> Option<String> {
    if detail.trim().is_empty() {
        return None;
    }
    let lower = detail.to_lowercase();
    /* 这几句都**只**指向型号命名；`unsupported` 单用太宽（参数也能 unsupported），
       所以要求它后面紧跟 model。 */
    let looks_like_model = lower.contains("supported api model")
        || lower.contains("model not exist")
        || lower.contains("model does not exist")
        || lower.contains("invalid model")
        || lower.contains("unknown model")
        || lower.contains("model not found")
        || lower.contains("unsupported model")
        || lower.contains("model is not supported");
    if !looks_like_model {
        return None;
    }
    let passed = extract_passed_model(detail);
    let supported = extract_supported_models(detail);
    let available = supported.join("、");
    let hint = match (passed.as_deref(), supported.is_empty()) {
        (Some(name), false) => format!(
            "模型「{name}」不被服务商接受，可用：{available}。请到「设置 → AI」用「获取可用模型」重选"
        ),
        (Some(name), true) => format!(
            "模型「{name}」不被服务商接受：请到「设置 → AI」用「获取可用模型」重选"
        ),
        (None, false) => format!(
            "当前模型不被服务商接受，可用：{available}。请到「设置 → AI」重选"
        ),
        (None, true) => "模型名不被服务商接受：请到「设置 → AI」用「获取可用模型」重选".to_string(),
    };
    Some(hint)
}

/// `... but you passed <name>` 里的那个名字。
///
/// 句点**不是**分隔符：`deepseek-v4.1-flash` 这类名字自己就带点。只按空白 / 逗号 /
/// 分号 / 右括号截断，末尾多出来的句号交给 `clean_model_token` 剥。
fn extract_passed_model(detail: &str) -> Option<String> {
    const MARKER: &str = "you passed ";
    let lower = detail.to_lowercase();
    let start = lower.find(MARKER)? + MARKER.len();
    let rest = detail.get(start..)?;
    let end = rest
        .find(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ')' | '）'))
        .unwrap_or(rest.len());
    let token = clean_model_token(rest.get(..end)?);
    (!token.is_empty()).then_some(token)
}

/// `the supported API model names are <a>, <b>` 里的型号列表。
///
/// 不按句号找结尾（型号里有点），而是逐个切开、**遇到第一个不像型号的片段就停**：
/// `..., deepseek-v4-pro, but you passed x.` 会在 `but you passed x`（含空格）处收住。
fn extract_supported_models(detail: &str) -> Vec<String> {
    const MARKER: &str = "supported api model names are";
    let lower = detail.to_lowercase();
    let Some(start) = lower.find(MARKER).map(|index| index + MARKER.len()) else {
        return Vec::new();
    };
    let Some(rest) = detail.get(start..) else {
        return Vec::new();
    };
    rest.split(',')
        .map(clean_model_token)
        .take_while(|token| !token.is_empty())
        .take(MAX_SUPPORTED_MODELS)
        .collect()
}

/// 从正文碎片里取出一个「像型号」的串；不像就返回空（调用方据此降级）。
fn clean_model_token(raw: &str) -> String {
    let trimmed = raw
        .trim()
        .trim_matches(|c: char| matches!(c, '`' | '"' | '\'' | '「' | '」' | '、' | '和'))
        .trim_end_matches('.')
        .trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_MODEL_NAME_CHARS
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':'))
    {
        return String::new();
    }
    trimmed.to_string()
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
    fn model_rejection_names_the_passed_model_and_the_supported_ones() {
        /* 真实样本：用户配了 deepseek-v4.1-flash，这个网关只认另外两个。 */
        let detail = "The supported API model names are deepseek-flash, deepseek-v4-pro, \
                      but you passed deepseek-v4.1-flash. (request_id: 6809dc98-7da2-4223-9bbe-7660409f3ef0)";
        let hint = model_rejection(detail).expect("模型名被拒必须被识别");
        assert!(hint.contains("deepseek-v4.1-flash"), "{hint}");
        assert!(hint.contains("deepseek-flash、deepseek-v4-pro"), "{hint}");
        assert!(hint.contains("设置 → AI"), "{hint}");
    }

    #[test]
    fn model_rejection_without_a_model_list_still_points_at_settings() {
        /* 只有一句「型号不存在」时也要能给出下一步，而不是沉默。 */
        let hint = model_rejection("Model Not Exist").expect("应识别为模型问题");
        assert!(hint.contains("获取可用模型"), "{hint}");
        assert!(!hint.contains("可用："), "没有列表就别编一个：{hint}");
    }

    #[test]
    fn parameter_errors_are_not_rewritten_as_model_errors() {
        /* 误报比不报更糟：把参数问题说成模型问题，用户会去改一个没错的字段。 */
        assert!(model_rejection("temperature must be <= 2").is_none());
        assert!(model_rejection("unsupported parameter: top_p").is_none());
        assert!(model_rejection("max_tokens is too large for model context").is_none());
        assert!(model_rejection("   ").is_none());
        assert!(model_rejection("").is_none());
    }

    #[test]
    fn model_tokens_are_whitelisted_and_bounded() {
        assert_eq!(clean_model_token(" `deepseek-flash` "), "deepseek-flash");
        assert_eq!(clean_model_token("gpt-4o:2024-08-06"), "gpt-4o:2024-08-06");
        assert_eq!(clean_model_token("deepseek flash"), "");
        assert_eq!(clean_model_token(&"x".repeat(MAX_MODEL_NAME_CHARS + 1)), "");
        /* 句末的点要剥掉，型号里的点要留住。 */
        assert_eq!(clean_model_token("deepseek-v4.1-flash."), "deepseek-v4.1-flash");
        /* 列表在「不像型号」的片段处收住，request_id 不会被当成型号带进提示语。 */
        let listed = extract_supported_models(
            "supported API model names are deepseek-flash, deepseek-v4-pro, \
             but you passed deepseek-v4.1-flash. (request_id: abc)",
        );
        assert_eq!(listed, vec!["deepseek-flash", "deepseek-v4-pro"]);
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
