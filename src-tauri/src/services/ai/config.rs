//! AI 配置的加载 / 校验 / 保存，以及密钥的读写。
//!
//! ## 两层存储，与 WebDAV 同型
//!
//! - 非机密（地址 / 模型 / 开关 / 标题）→ 业务库 `settings` 的 `ai.config`；
//! - 密钥 → `infra::secret`（桌面 DPAPI、手机 Keystore），视图只回 `hasKey`。
//!
//! `ai.config` **不跨设备**（`NON_PORTABLE_SETTING_KEYS`）：密钥本来就不跟着走，
//! 把开关和地址搬过去，只会让另一台机器拿着默认地址 + 空密钥反复失败。
//!
//! ## 为什么校验错误用 `IO_ERROR`
//!
//! `ErrorCode` 是闭集，加一个码要同步四份契约 + 一份 ADR。AI 配置非法与「系统调用
//! 失败」共享同一句话术的世界观并不完美，但 message 足够具体（哪个字段、为什么），
//! 而多一个码换来的只是前端多一个分支。等错误码表下一次正式扩编再拆。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::secret;
use crate::models::ai::{AiConfig, AiConfigView, AI_CONFIG_KEY, MAX_TAGS_PER_TARGET};
use crate::repositories::settings;

/// 密钥在凭据存储里的键名（`ai.bin` / SharedPreferences `ai`）。
pub const KEY_AI: &str = "ai";

const BASE_URL_MAX: usize = 300;
const MODEL_MAX: usize = 120;
const HEADING_MAX: usize = 120;
const KEY_MAX: usize = 4096;

pub async fn load(pool: &SqlitePool) -> AppResult<AiConfig> {
    let Some(raw) = settings::get_value(pool, AI_CONFIG_KEY).await? else {
        return Ok(AiConfig::default());
    };
    /* 一条坏 JSON 不该让设置页打不开：字段级 `default` 已补缺键，整条解不开就用默认值。 */
    Ok(serde_json::from_str::<AiConfig>(&raw).unwrap_or_default())
}

pub async fn view(pool: &SqlitePool) -> AppResult<AiConfigView> {
    Ok(AiConfigView {
        config: load(pool).await?,
        has_key: secret::get(KEY_AI).await.ok().flatten().is_some(),
        secret_available: secret::available(),
    })
}

/// `api_key` 三态与 WebDAV 密码一致：`None` 不动、空串清空、值明文写入。
pub async fn save(
    pool: &SqlitePool,
    config: &AiConfig,
    api_key: Option<&str>,
    now: i64,
) -> AppResult<AiConfigView> {
    let normalized = validated(config)?;
    /* 两条边界：
    1. 已存密钥只跟随保存时的域名 —— 分析窗一旦被脚本注入，能改的只有 URL，
       不该顺带把密钥「转发」到新主机；换域名必须重新粘贴一次。
    2. 读不到凭据存储时按「没有密钥」处理：后续请求同样取不到密钥，不存在可被
       转发的秘密；反过来把保存整条拒掉，会让没有凭据存储的平台连改地址都做不到。 */
    let has_saved_key = secret::get(KEY_AI)
        .await
        .ok()
        .flatten()
        .is_some_and(|value| !value.trim().is_empty());
    if api_key.is_none()
        && has_saved_key
        && !same_origin(&load(pool).await?.base_url, &normalized.base_url)
    {
        return Err(invalid("更换服务地址后需重新填写 API Key"));
    }
    if let Some(key) = api_key {
        let key = validate_api_key(key)?;
        let result = if key.is_empty() {
            secret::clear(KEY_AI).await
        } else {
            secret::put(KEY_AI, &key).await
        };
        result.map_err(|err| {
            AppError::new(ErrorCode::IoError, format!("保存 API Key 失败：{err}"))
        })?;
    }
    let raw = serde_json::to_string(&normalized).map_err(AppError::db)?;
    settings::set_value(pool, AI_CONFIG_KEY, &raw, now).await?;
    view(pool).await
}

/// 已保存的密钥（不要求总开关打开：「测试连接」应在启用之前就能用）。
pub async fn saved_key() -> AppResult<Option<String>> {
    let key = secret::get(KEY_AI)
        .await
        .map_err(|err| AppError::new(ErrorCode::IoError, format!("读取 API Key 失败：{err}")))?;
    Ok(key.filter(|value| !value.trim().is_empty()))
}

/// 需要调用模型的入口先过这一关：总开关 → 密钥 → 返回可用的配置。
pub async fn require_ready(pool: &SqlitePool) -> AppResult<(AiConfig, String)> {
    let config = load(pool).await?;
    if !config.enabled {
        return Err(AppError::new(
            ErrorCode::AiNotConfigured,
            "AI 未启用：请先在「设置 → AI」打开总开关",
        ));
    }
    let key = saved_key()
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::AiNotConfigured, "还没有保存 API Key"))?;
    Ok((config, key))
}

/// 「获取可用模型」的密钥解析：草稿密钥优先；没有草稿时只复用**同源**的已存密钥，
/// 防止被注入的界面把密钥转发到另一个主机。
pub(crate) async fn resolve_key(
    pool: &SqlitePool,
    base_url: &str,
    draft_key: Option<&str>,
) -> AppResult<String> {
    if let Some(key) = draft_key {
        let key = validate_api_key(key)?;
        if key.is_empty() {
            return Err(AppError::new(
                ErrorCode::IoError,
                "还没有 API Key：请填写后再获取模型",
            ));
        }
        return Ok(key);
    }
    if !same_origin(&load(pool).await?.base_url, base_url) {
        return Err(invalid("更换服务地址后需重新填写 API Key"));
    }
    saved_key()
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::IoError, "还没有保存 API Key"))
}

/// Base URL 归一 + 校验：`get` 与「获取可用模型」共用同一套形状判据。
pub(crate) fn validate_base_url(value: &str) -> AppResult<String> {
    let base_url = value.trim().trim_end_matches('/').to_string();
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
        return Err(invalid("Base URL 必须是 http:// 或 https:// 开头"));
    }
    if base_url.chars().count() > BASE_URL_MAX || base_url.contains(['\n', '\r', ' ']) {
        return Err(invalid("Base URL 不合法（过长、含空白或换行）"));
    }
    let parsed = url::Url::parse(&base_url).map_err(|_| invalid("Base URL 不是合法网址"))?;
    if parsed.host_str().is_none() {
        return Err(invalid("Base URL 缺少主机名"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(invalid("Base URL 不能用 user:pass@ 形式携带凭据"));
    }
    if parsed.scheme() == "http" && !is_loopback_host(&parsed) {
        return Err(invalid(
            "非本机服务必须使用 HTTPS；HTTP 仅允许 localhost/回环地址",
        ));
    }
    Ok(base_url)
}

fn is_loopback_host(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        Some(url::Host::Domain(domain)) => {
            domain.eq_ignore_ascii_case("localhost")
                || domain.eq_ignore_ascii_case("localhost.localdomain")
        }
        None => false,
    }
}

/// 空串是合法输入（保存时表示清除），由调用方决定是否接受。
pub(crate) fn validate_api_key(value: &str) -> AppResult<String> {
    let key = value.trim();
    if key.chars().count() > KEY_MAX || key.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(invalid(
            "API Key 不能包含空白或控制字符，且不超过 4096 个字符",
        ));
    }
    Ok(key.to_string())
}

/// 保存前归一 + 校验；只拦「发出去一定失败」的形状。
fn validated(config: &AiConfig) -> AppResult<AiConfig> {
    let base_url = validate_base_url(&config.base_url)?;
    let model = config.model.trim().to_string();
    if model.is_empty() || model.chars().count() > MODEL_MAX || model.contains(['\n', '\r']) {
        return Err(invalid("模型名不能为空、不能换行，且不超过 120 个字符"));
    }
    let heading = config.daily_heading.trim().to_string();
    let hashes = heading.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&hashes)
        || heading.get(hashes..).unwrap_or("").trim().is_empty()
        || heading.chars().count() > HEADING_MAX
        || heading.contains(['\n', '\r'])
    {
        return Err(invalid(
            "汇总标题必须是「#### 文字」的形式，且不超过 120 个字符",
        ));
    }
    Ok(AiConfig {
        enabled: config.enabled,
        base_url,
        model,
        daily_enabled: config.daily_enabled,
        item_tags_enabled: config.item_tags_enabled,
        app_tags_enabled: config.app_tags_enabled,
        daily_heading: heading,
        max_tags_per_target: config.max_tags_per_target.clamp(1, MAX_TAGS_PER_TARGET),
    })
}

fn invalid(message: &str) -> AppError {
    AppError::new(ErrorCode::IoError, format!("AI 配置无效：{message}"))
}

/// 同源 = scheme + host + port 都相同；路径从 `/v1` 换到 `/v1beta` 不算换主机。
pub(crate) fn same_origin(left: &str, right: &str) -> bool {
    match (url::Url::parse(left), url::Url::parse(right)) {
        (Ok(left), Ok(right)) => left.origin() == right.origin(),
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::support::fresh_pool;

    #[test]
    fn bad_urls_models_and_headings_are_rejected() {
        let mut config = AiConfig {
            base_url: "ftp://x".into(),
            ..AiConfig::default()
        };
        assert!(validated(&config).is_err());
        config.base_url = "https://api.deepseek.com/v1/".into();
        assert_eq!(
            validated(&config).expect("合法").base_url,
            "https://api.deepseek.com/v1"
        );
        config.model = " ".into();
        assert!(validated(&config).is_err());
        config.model = "deepseek-chat".into();
        config.daily_heading = "今日汇总".into();
        assert!(validated(&config).is_err());
        config.daily_heading = "#### 今日汇总".into();
        config.max_tags_per_target = 99;
        assert_eq!(
            validated(&config).expect("合法").max_tags_per_target,
            MAX_TAGS_PER_TARGET
        );
        config.base_url = "https://".into();
        assert!(validated(&config).is_err());
        config.base_url = "https://user:pass@api.deepseek.com/v1".into();
        assert!(validated(&config).is_err());
        config.base_url = "http://api.example.com/v1".into();
        assert!(validated(&config).is_err());
        config.base_url = "http://127.0.0.1:11434/v1".into();
        assert!(validated(&config).is_ok());
        config.base_url = "http://[::1]:11434/v1".into();
        assert!(validated(&config).is_ok());
        config.base_url = "http://localhost:11434/v1".into();
        assert!(validated(&config).is_ok());
    }

    #[test]
    fn origin_compares_scheme_host_and_port_only() {
        assert!(same_origin("https://api.x.com/v1", "https://api.x.com/v2"));
        assert!(!same_origin(
            "https://api.x.com/v1",
            "https://evil.x.com/v1"
        ));
        assert!(!same_origin("http://api.x.com/v1", "https://api.x.com/v1"));
        assert!(!same_origin(
            "https://api.x.com:443/v1",
            "https://api.x.com:8443/v1"
        ));
    }

    #[tokio::test]
    async fn missing_row_loads_defaults_and_round_trips() {
        let pool = fresh_pool("ai-config").await;
        let defaults = load(&pool).await.expect("读默认值");
        assert_eq!(defaults, AiConfig::default());
        let config = AiConfig {
            enabled: true,
            model: "m".into(),
            ..AiConfig::default()
        };
        save(&pool, &config, None, 1).await.expect("保存");
        assert_eq!(load(&pool).await.expect("读回"), config);
    }
}
