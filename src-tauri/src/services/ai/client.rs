//! OpenAI 兼容客户端：配置注入、超时和错误口径。

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::time::{sleep, timeout};

use super::error_mapping::{is_retryable, map_openai_error, retry_delay as bounded_retry_delay};

use async_openai::config::OpenAIConfig;
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
pub async fn list_models(base_url: &str, api_key: &str) -> AppResult<Vec<String>> {
    let client = openai_client(base_url, api_key, MODEL_LIST_SINGLE_TIMEOUT)?;
    let started = Instant::now();
    let mut attempt = 0usize;
    let response = loop {
        if started.elapsed() >= MODEL_LIST_TOTAL_BUDGET {
            return Err(AppError::new(ErrorCode::AiTimeout, "获取模型列表超时"));
        }
        attempt += 1;
        let remaining = MODEL_LIST_TOTAL_BUDGET.saturating_sub(started.elapsed());
        let request_budget = MODEL_LIST_SINGLE_TIMEOUT.min(remaining);
        match timeout(request_budget, client.models().list()).await {
            Ok(Ok(response)) => break response,
            Ok(Err(err)) => {
                let mapped = map_openai_error(&err, api_key);
                if attempt > MAX_RETRIES || !is_retryable(mapped.code) {
                    return Err(mapped);
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
    };
    Ok(model_ids(response.data.into_iter().map(|model| model.id)))
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
}
