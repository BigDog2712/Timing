//! AI 域的 IPC 形状与静态配置。
//!
//! ## 协议是 OpenAI 兼容，不是 "OpenAI 专有"
//!
//! `base_url` 可指向 DeepSeek / Kimi / Ollama / LM Studio / 自建网关，协议只用到
//! `POST /chat/completions`。传输层交给 `async-openai`（见 `services::ai::client`），
//! 这里只描述**我们自己的**配置与结果形状。
//!
//! ## 密钥不在这里
//!
//! `api_key` 只出现在命令入参里，落盘走 `infra::secret`（DPAPI / Keystore）。
//! `AiConfig` 会被序列化进 `settings` 表、被整库导出带走 —— 它里面永远不许有密钥。

use serde::{Deserialize, Serialize};

#[allow(dead_code)]
fn is_zero(value: &usize) -> bool {
    *value == 0
}

/// 主设置键（非机密：地址 / 模型 / 开关 / 标题）。
pub const AI_CONFIG_KEY: &str = "ai.config";

/// 默认落点：OpenAI 官方；国内服务商填各自的 `/v1` 兼容地址。
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "gpt-4o-mini";
/// 今日汇总写进 md 的标题（独立于 md_sync 的五个 kind，不会被它们的同步覆盖）。
pub const DEFAULT_DAILY_HEADING: &str = "#### AI 今日汇总";
pub const DEFAULT_MAX_TAGS: u8 = 3;
pub const MAX_TAGS_PER_TARGET: u8 = 8;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    /// 总开关：关着时建议 / 汇总都拒绝执行（设置页仍可保存与测试连接）。
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    /// 是否允许把生成结果写进日记 md；关着时只预览、不落盘。
    pub daily_enabled: bool,
    /// 建议窗口的两个入口（分开是因为用户可能只想用其中一个）。
    pub item_tags_enabled: bool,
    pub app_tags_enabled: bool,
    /// md 区块标题（必须是 `#### 文字` 形式）。
    pub daily_heading: String,
    /// 单条事项 / 应用最多回几个标签。
    pub max_tags_per_target: u8,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: DEFAULT_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
            daily_enabled: false,
            item_tags_enabled: true,
            app_tags_enabled: true,
            daily_heading: DEFAULT_DAILY_HEADING.to_string(),
            max_tags_per_target: DEFAULT_MAX_TAGS,
        }
    }
}

/// 设置页一次拿全：配置 + 「有没有密钥」+「这个平台能不能存密钥」。
///
/// 只回布尔，不回密钥本身 —— 与 WebDAV 密码同一条纪律（视图层永远拿不到明文）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    pub config: AiConfig,
    pub has_key: bool,
    pub secret_available: bool,
}

/// 「测试连接」的结果。**网络失败不回 Err**：UI 要显示具体原因，而 `IO_ERROR` 的
/// 通用文案会把「401 密钥不对」和「域名打不开」压成同一句。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: i64,
}

/// 「获取可用模型」：地址可先于保存试用；`api_key` 为空时只认**同源**的已存密钥。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListModelsRequest {
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTagMode {
    Item,
    App,
}

/// 一个待分类对象。`id` 是前端的主键（事项 id / 应用 key），原样回传，
/// 后端不解释它 —— 这样同一组命令能同时服务两种对象。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTagTarget {
    pub id: String,
    /// 给模型看的文本：事项名，或「应用名 / exe」。
    pub text: String,
}

/// 候选标签。`key` 是前端落库用的键（事项模式 = 标签路径，应用模式 = 分类键），
/// `label` 是给模型看的人读文本（`学习/考公`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTagCandidate {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestRequest {
    pub mode: AiTagMode,
    pub targets: Vec<AiTagTarget>,
    pub candidates: Vec<AiTagCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTagSuggestion {
    pub id: String,
    /// Tags validated against the supplied candidate catalog.
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestStats {
    pub parsed: usize,
    pub dropped: usize,
    pub attempts: usize,
    /// Number of sequential target batches processed for this suggestion request.
    /// Zero is omitted so older clients continue seeing the original stats shape.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub batches: usize,
    /// Number of batches that failed after transport/parser retries.
    /// Zero is omitted so older clients continue seeing the original stats shape.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub failed_batches: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestResponse {
    pub suggestions: Vec<AiTagSuggestion>,
    pub stats: AiSuggestStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDailySummary {
    pub date: String,
    pub markdown: String,
    /// 写入了哪个文件；`None` = 没有配置落点（或 `daily_enabled` 关着），只预览。
    pub path: Option<String>,
    pub at: i64,
}

#[cfg(test)]
mod tests {
    use super::{AiSuggestResponse, AiSuggestStats};
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct LegacyStats {
        parsed: usize,
        dropped: usize,
        attempts: usize,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyResponse {
        stats: LegacyStats,
    }

    #[test]
    fn legacy_clients_ignore_optional_batch_stats() {
        let response = AiSuggestResponse {
            suggestions: Vec::new(),
            stats: AiSuggestStats {
                parsed: 1,
                dropped: 2,
                attempts: 3,
                batches: 2,
                failed_batches: 1,
            },
        };
        let encoded = serde_json::to_string(&response).expect("response serializes");
        let legacy: LegacyResponse =
            serde_json::from_str(&encoded).expect("legacy response remains readable");
        assert_eq!(
            legacy.stats,
            LegacyStats {
                parsed: 1,
                dropped: 2,
                attempts: 3,
            }
        );
    }

    #[test]
    fn zero_batch_stats_are_omitted_for_compatibility() {
        let stats = AiSuggestStats::default();
        let encoded = serde_json::to_value(stats).expect("stats serialize");
        assert!(encoded.get("batches").is_none());
        assert!(encoded.get("failedBatches").is_none());
    }
}
