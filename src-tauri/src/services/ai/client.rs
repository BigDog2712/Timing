//! OpenAI 兼容客户端：配置注入、超时和错误口径。

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::time::{sleep, timeout};

use super::error_mapping::{is_retryable, map_openai_error, retry_delay as bounded_retry_delay};

use async_openai::config::OpenAIConfig;
use async_openai::error::{ApiError, ApiErrorResponse, OpenAIError};
use async_openai::types::chat::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestUserMessage, CreateChatCompletionRequestArgs,
};
use async_openai::Client;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::models::ai::{AiConfig, AiTestResult};

/// 汇总请求会带上几十条记录的 JSON，90s 足够；再长用户也会认为卡死。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub(super) const MAX_RETRIES: usize = 2;
pub(super) const RETRY_DELAYS: [Duration; MAX_RETRIES] =
    [Duration::from_secs(1), Duration::from_secs(2)];
const MODEL_LIST_SINGLE_TIMEOUT: Duration = Duration::from_secs(15);
const MODEL_LIST_TOTAL_BUDGET: Duration = Duration::from_secs(30);
const SUGGEST_SINGLE_TIMEOUT: Duration = Duration::from_secs(45);
const SUGGEST_TOTAL_BUDGET: Duration = Duration::from_secs(120);
const TEST_SINGLE_TIMEOUT: Duration = Duration::from_secs(15);
const TEST_TOTAL_BUDGET: Duration = Duration::from_secs(30);
const DAILY_SINGLE_TIMEOUT: Duration = Duration::from_secs(90);
const DAILY_TOTAL_BUDGET: Duration = Duration::from_secs(180);
/// 模型目录只用来填一个输入框：上限防止自建网关一次返回上千条。
const MAX_MODELS: usize = 200;

pub struct ChatClient {
    client: Client<OpenAIConfig>,
    model: String,
    api_key: String,
    single_timeout: Duration,
    total_budget: Duration,
}

fn http_client(single_timeout: Duration) -> AppResult<reqwest::Client> {
    crate::infra::md_webdav::tls::builder()
        .and_then(|builder| {
            builder
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(single_timeout)
                .build()
                .map_err(|err| err.to_string())
        })
        .map_err(|_| AppError::new(ErrorCode::AiNetwork, "AI 网络客户端初始化失败"))
}

fn openai_client(
    base_url: &str,
    api_key: &str,
    single_timeout: Duration,
) -> AppResult<Client<OpenAIConfig>> {
    let openai = OpenAIConfig::new()
        .with_api_base(base_url)
        .with_api_key(api_key);
    /* 必须用 `Client::build`：`with_config()` 会先 `reqwest::Client::new()` 建一个默认
    client，而我们的 reqwest 0.13 是 `rustls-no-provider` —— provider 由
    `tls::client_config()` 安装，建默认 client 时还没装，进程直接 panic（命令 future
    一起没了，界面永远停在「测试中…」）。`build()` 不碰默认 client。 */
    Ok(Client::build(http_client(single_timeout)?, openai))
}

pub fn build_suggest(config: &AiConfig, api_key: &str) -> AppResult<ChatClient> {
    build_with_timeout(
        config,
        api_key,
        SUGGEST_SINGLE_TIMEOUT,
        SUGGEST_TOTAL_BUDGET,
    )
}

pub fn build_daily(config: &AiConfig, api_key: &str) -> AppResult<ChatClient> {
    build_with_timeout(config, api_key, DAILY_SINGLE_TIMEOUT, DAILY_TOTAL_BUDGET)
}

fn build_test(config: &AiConfig, api_key: &str) -> AppResult<ChatClient> {
    build_with_timeout(config, api_key, TEST_SINGLE_TIMEOUT, TEST_TOTAL_BUDGET)
}

fn build_with_timeout(
    config: &AiConfig,
    api_key: &str,
    single_timeout: Duration,
    total_budget: Duration,
) -> AppResult<ChatClient> {
    Ok(ChatClient {
        client: openai_client(&config.base_url, api_key, single_timeout)?,
        model: config.model.clone(),
        api_key: api_key.to_string(),
        single_timeout,
        total_budget,
    })
}

/// `GET /models`：只读目录，不要求总开关打开；密钥由调用方按同源规则解析。
///
/// **不走 `client.models().list()`**：`async_openai` 的 `Model` 把 `created: u32` 当必填，
/// 而 OpenAI 兼容网关普遍只回 `{id, object, owned_by}` —— DeepSeek 就是这样（实测它的
/// `/models` 文档示例里没有 `created`），Ollama 的自建端点同理。缺字段 → 整条反序列化
/// 失败 → 用户看到「AI 服务响应格式异常」，目录永远拉不到，而型号本身是能用的。
/// 这里只认 `data[].id`：多出来的字段忽略，缺字段不影响。
pub async fn list_models(base_url: &str, api_key: &str) -> AppResult<Vec<String>> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let http = http_client(MODEL_LIST_SINGLE_TIMEOUT)?;
    let started = Instant::now();
    let mut attempt = 0usize;
    loop {
        if started.elapsed() >= MODEL_LIST_TOTAL_BUDGET {
            return Err(AppError::new(ErrorCode::AiTimeout, "获取模型列表超时"));
        }
        attempt += 1;
        let remaining = MODEL_LIST_TOTAL_BUDGET.saturating_sub(started.elapsed());
        let request_budget = MODEL_LIST_SINGLE_TIMEOUT.min(remaining);
        match timeout(request_budget, fetch_models(&http, &url, api_key)).await {
            Ok(Ok(ids)) => return Ok(model_ids(ids)),
            Ok(Err(error)) => {
                if attempt > MAX_RETRIES || !is_retryable(error.code) {
                    return Err(error);
                }
                let remaining = MODEL_LIST_TOTAL_BUDGET.saturating_sub(started.elapsed());
                sleep(bounded_retry_delay(
                    None,
                    jittered_retry_delay(RETRY_DELAYS[attempt - 1]),
                    remaining,
                ))
                .await;
            }
            Err(_) => {
                if attempt > MAX_RETRIES {
                    return Err(AppError::new(ErrorCode::AiTimeout, "获取模型列表超时"));
                }
                let remaining = MODEL_LIST_TOTAL_BUDGET.saturating_sub(started.elapsed());
                sleep(bounded_retry_delay(
                    None,
                    jittered_retry_delay(RETRY_DELAYS[attempt - 1]),
                    remaining,
                ))
                .await;
            }
        }
    }
}

/// 一次目录请求。非 2xx 走 `map_openai_error` 那套口径（401/403 认证、429 限流、5xx 上游），
/// 不在这里另立一份映射 —— 两张表迟早对不上。
async fn fetch_models(
    http: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> AppResult<Vec<String>> {
    let response = http
        .get(url)
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|err| {
            if err.is_timeout() {
                AppError::new(ErrorCode::AiTimeout, "获取模型列表超时")
            } else {
                AppError::new(ErrorCode::AiNetwork, "无法连接 AI 服务，请检查网络后重试")
            }
        })?;
    let status = response.status();
    /* 正文读完再判状态：错误体里那句 `error.message` 是用户唯一的线索。 */
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_openai_error(
            &OpenAIError::ApiError(ApiErrorResponse {
                status_code: status,
                api_error: ApiError {
                    message: error_message(&body),
                    r#type: None,
                    param: None,
                    code: None,
                    misalignment: None,
                },
            }),
            api_key,
        ));
    }
    parse_model_ids(&body)
        .ok_or_else(|| AppError::new(ErrorCode::AiUpstream, "模型目录格式无法识别，请手动填写型号"))
}

/// 目录正文 → 型号 id。只认 `{"data":[{"id":"..."}]}`，其它字段一律不看。
/// 解不开返回 `None`：让调用方说「手动填」，而不是假装目录是空的。
fn parse_model_ids(body: &str) -> Option<Vec<String>> {
    #[derive(serde::Deserialize)]
    struct Row {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct List {
        data: Vec<Row>,
    }
    serde_json::from_str::<List>(body)
        .ok()
        .map(|list| list.data.into_iter().map(|row| row.id).collect())
}

/// 错误正文里的那句话。取不到就把原文截一段——比「请求失败」有用。
fn error_message(body: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Envelope {
        error: Inner,
    }
    #[derive(serde::Deserialize)]
    struct Inner {
        message: String,
    }
    if let Ok(parsed) = serde_json::from_str::<Envelope>(body) {
        if !parsed.error.message.trim().is_empty() {
            return parsed.error.message;
        }
    }
    body.trim().chars().take(120).collect()
}

fn model_ids(ids: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out.truncate(MAX_MODELS);
    out
}

impl ChatClient {
    /// 一次非流式对话。`system` 定角色与输出纪律，`user` 是本次载荷。
    pub async fn chat(&self, system: &str, user: &str) -> AppResult<String> {
        let request = CreateChatCompletionRequestArgs::default()
            .model(self.model.clone())
            .messages(vec![
                ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage::from(
                    system,
                )),
                ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage::from(user)),
            ])
            .temperature(0.2_f32)
            .build()
            .map_err(|_| AppError::new(ErrorCode::AiBadRequest, "AI 请求参数无效"))?;
        let started = Instant::now();
        let mut attempt = 0usize;
        let response = loop {
            if started.elapsed() >= self.total_budget {
                return Err(AppError::new(ErrorCode::AiTimeout, "AI 请求总预算超时"));
            }
            attempt += 1;
            let remaining = self.total_budget.saturating_sub(started.elapsed());
            let request_budget = self.single_timeout.min(remaining);
            match timeout(request_budget, self.client.chat().create(request.clone())).await {
                Ok(Ok(response)) => break response,
                Ok(Err(err)) => {
                    let mapped = map_openai_error(&err, &self.api_key);
                    if attempt > MAX_RETRIES || !is_retryable(mapped.code) {
                        return Err(mapped);
                    }
                    let delay = bounded_retry_delay(
                        None,
                        jittered_retry_delay(RETRY_DELAYS[attempt - 1]),
                        self.total_budget.saturating_sub(started.elapsed()),
                    );
                    sleep(delay).await;
                }
                Err(_) if started.elapsed() >= self.total_budget => {
                    return Err(AppError::new(ErrorCode::AiTimeout, "AI 请求总预算超时"));
                }
                Err(_) => {
                    if attempt > MAX_RETRIES {
                        return Err(AppError::new(ErrorCode::AiTimeout, "AI 单次请求超时"));
                    }
                    let delay = bounded_retry_delay(
                        None,
                        jittered_retry_delay(RETRY_DELAYS[attempt - 1]),
                        self.total_budget.saturating_sub(started.elapsed()),
                    );
                    sleep(delay).await;
                }
            }
        };
        response
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .ok_or_else(|| AppError::new(ErrorCode::AiParse, "AI 返回内容为空"))
    }
}

fn jittered_retry_delay(base: Duration) -> Duration {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or_default();
    let jitter_percent = (seed % 41) as i64 - 20;
    let factor = (100 + jitter_percent) as u128;
    let jittered_nanos = base.as_nanos().saturating_mul(factor) / 100;
    Duration::from_nanos(u64::try_from(jittered_nanos).unwrap_or(u64::MAX))
}

/// 「测试连接」：真发一次最小请求。网络/鉴权失败回 `ok=false` 而不是 `Err`，
/// 让设置页能把供应商的原话显示出来（`IO_ERROR` 的通用文案分不清 401 与 DNS）。
pub async fn test_connection(config: &AiConfig, api_key: &str) -> AiTestResult {
    let started = Instant::now();
    let outcome = match build_test(config, api_key) {
        Ok(client) => {
            client
                .chat(
                    "你是连通性检测助手，只按用户要求回复。",
                    "只回复两个字母：OK",
                )
                .await
        }
        Err(err) => Err(err),
    };
    let latency_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    match outcome {
        Ok(text) => AiTestResult {
            ok: true,
            message: format!("连接成功：{}（模型 {}）", squash(&text), config.model),
            latency_ms,
        },
        Err(err) => AiTestResult {
            ok: false,
            message: err.message,
            latency_ms,
        },
    }
}

/// 供应商有时会回一整段话；测试连接的消息条不滚动，截到一行。
fn squash(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = one_line.chars();
    let short: String = chars.by_ref().take(60).collect();
    if chars.next().is_some() {
        format!("{short}…")
    } else {
        short
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_ids_trim_dedup_and_drop_empty() {
        let ids = vec![" b ".into(), "a".into(), "a".into(), "".into(), "  ".into()];
        assert_eq!(model_ids(ids), vec!["a", "b"]);
    }

    #[test]
    fn model_ids_are_capped_at_the_ui_budget() {
        let ids = (0..MAX_MODELS + 5).map(|i| format!("m{i:03}"));
        let out = model_ids(ids);
        assert_eq!(out.len(), MAX_MODELS);
        assert_eq!(out[0], "m000");
    }

    #[test]
    fn model_catalog_tolerates_entries_without_created() {
        /* 真实形状（DeepSeek / Ollama 的 OpenAI 兼容端点）：每条只有 id / object / owned_by。
           `async_openai::Model` 把 `created: u32` 当必填，用它解析就是「响应格式异常」。 */
        let body = r#"{"object":"list","data":[
            {"id":"deepseek-flash","object":"model","owned_by":"deepseek"},
            {"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek","created":1700000000}
        ]}"#;
        assert_eq!(
            parse_model_ids(body),
            Some(vec!["deepseek-flash".to_string(), "deepseek-v4-pro".to_string()])
        );
    }

    #[test]
    fn empty_or_odd_catalogs_are_told_apart() {
        /* 空目录是合法答复（前端提示「请手动填写」）；解不开要报错，不能假装是空的。 */
        assert_eq!(parse_model_ids(r#"{"object":"list","data":[]}"#), Some(vec![]));
        assert_eq!(parse_model_ids("<html>gateway</html>"), None);
        assert_eq!(parse_model_ids(r#"{"data":[{"object":"model"}]}"#), None);
    }

    #[test]
    fn error_body_message_is_preferred_over_raw_text() {
        let body = r#"{"error":{"message":"Authentication Fails (governor)","type":"authentication_error"}}"#;
        assert_eq!(error_message(body), "Authentication Fails (governor)");
        assert_eq!(error_message("  plain text  "), "plain text");
        assert_eq!(error_message(&"x".repeat(300)).chars().count(), 120);
        assert_eq!(error_message(r#"{"error":{"message":"   "}}"#), r#"{"error":{"message":"   "}}"#);
    }
}
