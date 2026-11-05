//! 同步配置的加载 / 保存 / 默认值合并。
//!
//! ## 三层来源
//!
//! 1. 插件 `contributes.mdSync.bindings`：作者给的默认落点；
//! 2. `settings` KV `plugin.md-sync.config`：用户在「设置 → 同步」里保存的覆盖值；
//! 3. 运行期兜底：没有插件、没有保存值 → 关闭同步，设置页显示「未安装」。
//!
//! ## 保存值优先，但**按 kind 补新落点**
//!
//! 总开关与「用户已经有的那个 kind」一律以保存值为准——用户在设置页改的根目录、
//! 文件模板、标题不能被插件默认值覆盖回去。
//!
//! 但保存值里**完全没有的 kind**，要用插件默认值补齐。理由是一个真实且必然发生的
//! 升级场景：插件后来新增了第三种落点（`todos`），而老用户的保存值只有两种。若整体
//! 以保存值为准，新的 kind 就永远进不了生效配置——设置页只渲染 `config.bindings`
//! （没有「添加落点」入口），用户既看不到它、也没法加它，新功能等于只对新装用户开放。
//!
//! 这不会「复活用户删掉的落点」：设置页现在只能**禁用**落点（`enabled: false`），
//! 不能删除，所以用户主动关掉的 kind 仍在保存值里、会被原样保留。

use serde_json::Error;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::constants::{MD_SYNC_POLL_MIN_SECS, MD_SYNC_POLL_SECS};
use crate::models::md_sync::{MdSyncBinding, MdSyncConfig};
use crate::repositories::settings;
use crate::services::plugin;

/// `settings` 表里的配置键（与插件 id 绑定，但删插件不会自动删配置）。
pub const CONFIG_KEY: &str = "plugin.md-sync.config";

/// 一次加载的结果：配置 + 声明它的插件身份（可能没有）。
#[derive(Debug, Clone)]
pub struct Loaded {
    pub config: MdSyncConfig,
    pub plugin_id: Option<String>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
}

impl Loaded {
    pub fn installed(&self) -> bool {
        self.plugin_id.is_some()
    }
}

/// 读取最终生效配置。解析失败按「没有保存值」处理，避免一条坏 JSON 让设置页打不开。
pub async fn load(pool: &SqlitePool, app_data_dir: &std::path::Path) -> AppResult<Loaded> {
    let list = plugin::list(app_data_dir);
    /* 配置键固定属于 `md-sync`：即使别的 v2 插件也声明 mdSync，也不抢这份配置。 */
    let plugin = list.plugins.iter().find(|item| {
        item.id == "md-sync" && item.enabled && item.error.is_none() && item.md_sync.is_some()
    });

    let defaults = plugin
        .and_then(|item| item.md_sync.as_ref())
        .map(|contribution| MdSyncConfig {
            enabled: true,
            poll_secs: crate::models::constants::MD_SYNC_POLL_SECS,
            bindings: contribution.bindings.clone(),
        });

    let saved = match settings::get_value(pool, CONFIG_KEY).await? {
        Some(raw) => serde_json::from_str::<MdSyncConfig>(&raw).ok(),
        None => None,
    };

    let config = match (saved, defaults) {
        (Some(saved), Some(defaults)) => MdSyncConfig {
            /* 总开关是用户的明确选择，保留。 */
            enabled: saved.enabled,
            /* 间隔同理：用户调过就用用户的，没调过就是默认 15 分钟。 */
            poll_secs: saved.poll_secs,
            bindings: merge_bindings(saved.bindings, defaults.bindings),
        },
        (Some(saved), None) => saved,
        (None, Some(defaults)) => defaults,
        (None, None) => MdSyncConfig {
            enabled: false,
            ..MdSyncConfig::default()
        },
    };

    Ok(Loaded {
        config,
        plugin_id: plugin.map(|item| item.id.clone()),
        plugin_name: plugin.map(|item| item.name.clone()),
        plugin_version: plugin.map(|item| item.version.clone()),
    })
}

/// 保存值在前（顺序与内容都不动），插件默认值里**保存值没有的 kind** 追加在后面。
fn merge_bindings(saved: Vec<MdSyncBinding>, defaults: Vec<MdSyncBinding>) -> Vec<MdSyncBinding> {
    let mut merged = saved;
    for binding in defaults {
        if !merged.iter().any(|item| item.kind == binding.kind) {
            merged.push(binding);
        }
    }
    merged
}

/// 自动同步间隔（秒）。读配置失败按默认值——轮询任务不能因为一条坏配置停摆。
///
/// [V0.11.3] 放在这里而不是 `mod.rs`：它只读配置，`mod.rs` 那个文件已经贴着
/// 300 行门禁，而配置文件本来就该是「配置相关的唯一去处」。
pub async fn poll_secs(pool: &SqlitePool, app_data_dir: &std::path::Path) -> u64 {
    match load(pool, app_data_dir).await {
        Ok(loaded) if loaded.config.poll_secs >= MD_SYNC_POLL_MIN_SECS => loaded.config.poll_secs,
        _ => MD_SYNC_POLL_SECS,
    }
}

/// 校验并保存。校验失败返回专用错误码，设置页能把原因显示在输入框下方。
pub async fn save(pool: &SqlitePool, config: &MdSyncConfig) -> AppResult<()> {
    config
        .validate()
        .map_err(AppError::md_sync_config_invalid)?;
    let raw = serde_json::to_string(config)
        .map_err(|err: Error| AppError::md_sync_config_invalid(err.to_string()))?;
    settings::set_value(pool, CONFIG_KEY, &raw, crate::platform::clock::now_ms()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::md_sync::MdSyncKind;

    fn binding(kind: MdSyncKind, heading: &str) -> MdSyncBinding {
        MdSyncBinding {
            kind,
            enabled: true,
            root: r"D:\vault".into(),
            file: "{date}.md".into(),
            heading: heading.into(),
        }
    }

    #[test]
    fn saved_binding_wins_but_a_new_kind_is_appended() {
        let saved = vec![binding(MdSyncKind::Timers, "#### 我改过的标题")];
        let defaults = vec![
            binding(MdSyncKind::Timers, "#### 插件默认"),
            binding(MdSyncKind::Todos, "#### 待办事项"),
        ];

        let merged = merge_bindings(saved, defaults);

        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged[0].heading, "#### 我改过的标题",
            "用户改的不能被默认值盖回"
        );
        assert_eq!(merged[1].kind, MdSyncKind::Todos, "新 kind 要补进来");
    }

    #[test]
    fn a_disabled_binding_is_not_resurrected() {
        /* 用户主动关掉某个落点 = saved 里仍有这个 kind（enabled=false）。
        合并必须原样保留它，不能拿默认值把它重新打开。 */
        let mut off = binding(MdSyncKind::Notes, "#### 便利贴");
        off.enabled = false;
        let merged = merge_bindings(vec![off], vec![binding(MdSyncKind::Notes, "#### 便利贴")]);

        assert_eq!(merged.len(), 1);
        assert!(!merged[0].enabled);
    }
}
