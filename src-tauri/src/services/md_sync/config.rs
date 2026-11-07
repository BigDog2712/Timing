//! 同步配置的加载 / 保存 / 默认值合并。
//!
//! ## 两层来源（[V0.11.5] 起不再读插件）
//!
//! 1. 内核默认值：`models::md_sync_config::default_bindings()` 的三档落点；
//! 2. `settings` KV `plugin.md-sync.config`：用户在「设置 → 同步」里保存的覆盖值。
//!
//! 键名里的 `plugin.` 前缀是**历史**（V0.4.0 时这份配置属于 `md-sync` 插件）：
//! 它已经是老用户磁盘上的键，改一次就等于让所有人的配置凭空消失，所以一动不动。
//!
//! ## 保存值优先，但**按 kind 补新落点**
//!
//! 总开关与「用户已经有的那个 kind」一律以保存值为准——用户在设置页改的根目录、
//! 文件模板、标题不能被默认值覆盖回去。
//!
//! 但保存值里**完全没有的 kind**，要用默认值补齐。理由是一个真实且必然发生的
//! 升级场景：内核后来新增了第三种落点（`todos`），而老用户的保存值只有两种。若整体
//! 以保存值为准，新的 kind 就永远进不了生效配置——设置页只渲染 `config.bindings`
//! （没有「添加落点」入口），用户既看不到它、也没法加它，新功能等于只对新装用户开放。
//!
//! 这不会「复活用户删掉的落点」：设置页现在只能**禁用**落点（`enabled: false`），
//! 不能删除，所以用户主动关掉的 kind 仍在保存值里、会被原样保留。

use serde_json::Error;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
/* [V0.11.19] 桌面已改事件驱动，运行时不再读「同步间隔」；只有手机端轮询还用它。
   `#[cfg(mobile)]` 让这两个常量在非手机产物里连 import 都不留（clippy 零告警）。 */
#[cfg(mobile)]
use crate::models::constants::{MD_SYNC_POLL_MIN_SECS, MD_SYNC_POLL_SECS};
use crate::models::md_sync::MdSyncBinding;
use crate::models::md_sync_config::{default_bindings, MdSyncConfig};
use crate::repositories::settings;

/// `settings` 表里的配置键（历史前缀，见模块注释：键名不改）。
pub const CONFIG_KEY: &str = "plugin.md-sync.config";

/// 读取最终生效配置。解析失败按「没有保存值」处理，避免一条坏 JSON 让设置页打不开。
pub async fn load(pool: &SqlitePool) -> AppResult<MdSyncConfig> {
    let saved = match settings::get_value(pool, CONFIG_KEY).await? {
        Some(raw) => serde_json::from_str::<MdSyncConfig>(&raw).ok(),
        None => None,
    };

    Ok(match saved {
        Some(saved) => MdSyncConfig {
            /* 总开关是用户的明确选择，保留（内核默认关，老用户存过 true 就还是 true）。 */
            enabled: saved.enabled,
            /* 间隔同理：用户调过就用用户的，没调过就是默认 15 分钟。 */
            poll_secs: saved.poll_secs,
            bindings: merge_bindings(saved.bindings, default_bindings()),
            /* [V0.11.13] 云端通道**原样带出**：保存值里是 `None` 就还是 `None`。
            这里绝不能像 bindings 那样「缺就补默认值」——补一个默认云端配置等于
            升级后自己打开通道，Timing 会开始往坚果云或磁盘第二处写用户文件。 */
            cloud: saved.cloud,
        },
        None => MdSyncConfig::default(),
    })
}

/// 保存值在前（顺序与内容都不动），默认值里**保存值没有的 kind** 追加在后面。
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
///
/// [V0.11.19] 只剩手机端轮询一个调用方：桌面的 md 链改成事件驱动 + 60s 兜底，
/// `pollSecs` 在界面上已无入口（PRD §3.3），但仍**原样保留在库里**（§15.2 透传）。
#[cfg(mobile)]
pub async fn poll_secs(pool: &SqlitePool) -> u64 {
    match load(pool).await {
        Ok(config) if config.poll_secs >= MD_SYNC_POLL_MIN_SECS => config.poll_secs,
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
            binding(MdSyncKind::Timers, "#### 内核默认"),
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
