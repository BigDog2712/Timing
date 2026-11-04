//! 同步配置的加载 / 保存 / 默认值合并。
//!
//! ## 两层来源
//!
//! 1. 出厂默认落点 `default_bindings()`：等价于原 `plugins/md-sync/plugin.json` 的声明；
//! 2. `settings` KV `plugin.md-sync.config`：用户在「设置 → 同步」里保存的覆盖值。
//!
//! 两者都没有时落点为空、同步关闭，设置页给出引导。
//!
//! [v2 撤回] Markdown 同步不再是插件：它要读写任意路径、后台定时、写库，
//! 属于宿主特权能力，不该由插件当配置携带者。`load` 因此不再查 `plugin::list`，
//! 出厂落点直接来自本文件——插件目录删掉也不影响同步。
//!
//! ## 保存值优先，但**按 kind 补新落点**
//!
//! 总开关与「用户已经有的那个 kind」一律以保存值为准——用户在设置页改的根目录、
//! 文件模板、标题不能被默认值覆盖回去。
//!
//! 但保存值里**完全没有的 kind**，要用默认值补齐。理由是一个真实且必然发生的
//! 升级场景：宿主后来新增了第三种落点（`todos`），而老用户的保存值只有两种。若整体
//! 以保存值为准，新的 kind 就永远进不了生效配置——设置页只渲染 `config.bindings`
//! （没有「添加落点」入口），用户既看不到它、也没法加它，新功能等于只对新装用户开放。
//!
//! 这不会「复活用户删掉的落点」：设置页现在只能**禁用**落点（`enabled: false`），
//! 不能删除，所以用户主动关掉的 kind 仍在保存值里、会被原样保留。

use serde_json::Error;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::md_sync::{MdSyncBinding, MdSyncConfig, MdSyncKind};
use crate::repositories::settings;

/// `settings` 表里的配置键。
///
/// 前缀 `plugin.` 是历史遗留（它曾经确实属于插件）。改键名要写数据迁移，
/// 而这份数据只有本机有价值——不值得为一个前缀冒丢配置的风险。
pub const CONFIG_KEY: &str = "plugin.md-sync.config";

/// 出厂落点。`root` 里的 `%USERPROFILE%` 由 `infra::md_file` 展开。
///
/// 用户改过的值优先（见 `merge_bindings`），这里只是「从没配过」时的起点。
fn default_bindings() -> Vec<MdSyncBinding> {
    /* 作者自己的 Obsidian 日记库。别人的机器上没有这个目录时，同步会报
       「路径不存在」并逐条列出——是可发现的具体错误，不是静默失败。
       在设置页点「选择文件夹」即可换成本机路径。 */
    const VAULT: &str = r"%USERPROFILE%\OneDrive\应用\remotely-save\Elio\1-MemeX\Diary";
    [
        (MdSyncKind::Timers, "#### 事项计时"),
        (MdSyncKind::Notes, "#### 便利贴"),
        (MdSyncKind::Todos, "#### 待办事项"),
    ]
    .into_iter()
    .map(|(kind, heading)| MdSyncBinding {
        kind,
        enabled: true,
        root: VAULT.into(),
        file: "{date}.md".into(),
        heading: heading.into(),
    })
    .collect()
}

/// 读取最终生效配置。解析失败按「没有保存值」处理，避免一条坏 JSON 让设置页打不开。
pub async fn load(pool: &SqlitePool) -> AppResult<MdSyncConfig> {
    let defaults = MdSyncConfig {
        enabled: true,
        bindings: default_bindings(),
    };

    let saved = match settings::get_value(pool, CONFIG_KEY).await? {
        Some(raw) => serde_json::from_str::<MdSyncConfig>(&raw).ok(),
        None => None,
    };

    Ok(match saved {
        Some(saved) => MdSyncConfig {
            /* 总开关是用户的明确选择，保留。 */
            enabled: saved.enabled,
            bindings: merge_bindings(saved.bindings, defaults.bindings),
        },
        None => defaults,
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
    fn factory_bindings_cover_every_kind() {
        let defaults = default_bindings();
        assert_eq!(defaults.len(), 3, "三种落点都要有出厂值");
        for kind in [MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos] {
            assert!(
                defaults.iter().any(|item| item.kind == kind),
                "{kind:?} 缺出厂落点"
            );
        }
    }

    #[test]
    fn saved_binding_wins_but_a_new_kind_is_appended() {
        let saved = vec![binding(MdSyncKind::Timers, "#### 我改过的标题")];
        let defaults = vec![
            binding(MdSyncKind::Timers, "#### 出厂默认"),
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
