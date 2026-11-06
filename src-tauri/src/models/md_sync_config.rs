//! 同步配置结构（V0.4.0 起；V0.11.3 从 `md_sync.rs` 拆出；V0.11.5 起内核自带默认值）。
//!
//! 为什么单独一个文件：`md_sync.rs` 里还放着种类枚举、落点、运行状态、报告等六七种结构，
//! 加上 V0.11.3 的 `poll_secs` 之后越过 300 行硬约束。配置是最独立的一块——
//! 它只依赖「落点」和四个常量，搬出来不需要动别人的调用点（`md_sync.rs` 里 re-export）。
//!
//! ## [V0.11.5] 默认落点搬进内核
//!
//! Markdown 同步不再是插件贡献点：默认三档落点由 `default_bindings()` 给出，
//! 不再读 `plugins/md-sync/plugin.json`。同时**出厂默认关**：
//! `Default::default().enabled = false`，用户第一次到「设置 → 同步」自己打开。
//! 老用户保存值里的 `enabled: true` 原样保留（合并在 `services/md_sync::config::load`）。

use serde::{Deserialize, Serialize};

use crate::models::constants::{MD_SYNC_POLL_MAX_SECS, MD_SYNC_POLL_MIN_SECS, MD_SYNC_POLL_SECS};
use crate::models::md_sync::{MdSyncBinding, MdSyncKind, MD_SYNC_MAX_BINDINGS};
use crate::models::md_sync_cloud::MdSyncCloud;

/// 出厂落点根目录。
///
/// `%APP_DIR%` = **数据根**（便携 `<exe>\data` / 回退 `%APPDATA%\com.timing.app`），
/// 不是 exe 目录本身。解析在 `infra::md_env::expand_env`，因此在换用户 / 换机器 /
/// 换盘符之后仍然跟着应用走（ADR-050 §5）。
pub const MD_SYNC_DEFAULT_ROOT: &str = r"%APP_DIR%\md";

/// 出厂文件模板：一天一个文件（`2026-11-05.md`）。
pub const MD_SYNC_DEFAULT_FILE: &str = "{date}.md";

/// 出厂三档落点，顺序 `timers → notes → todos`（设置页按这个顺序渲染）。
///
/// 标题必须走 `MdSyncKind::label()`：那是设置页、状态文案、导出区块共用的唯一来源，
/// 手抄一遍字符串就会在改文案时悄悄分叉——导出按标题定位区块，分叉等于找不到区块。
pub fn default_bindings() -> Vec<MdSyncBinding> {
    [MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos]
        .into_iter()
        .map(|kind| MdSyncBinding {
            kind,
            enabled: true,
            root: MD_SYNC_DEFAULT_ROOT.to_string(),
            file: MD_SYNC_DEFAULT_FILE.to_string(),
            heading: format!("#### {}", kind.label()),
        })
        .collect()
}

/// 最终生效的同步配置（用户保存过就以保存值为准）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncConfig {
    /// 出厂默认**关**：同步会往用户磁盘上写文件，不该在一次升级后自己开始写。
    ///
    /// `#[serde(default)]` 与 `Default` 必须同口径：老 JSON 里缺这个字段时按 `false` 补，
    /// 若这里还挂着 `default = "default_true"`，同一个字段就会有两套默认值。
    #[serde(default)]
    pub enabled: bool,
    /// [V0.11.3] 自动同步间隔（秒）。缺省读老配置时补默认值，不因新增字段让老 JSON 解析失败。
    #[serde(default = "default_poll_secs")]
    pub poll_secs: u64,
    #[serde(default)]
    pub bindings: Vec<MdSyncBinding>,
    /// [V0.11.13] 云端第二落点。`None` = 不启用云端通道，行为与 V0.11.12 逐字相同。
    ///
    /// 老配置里没有这个键 → `None`：**不给默认值**。升级后自己开通道等于替用户决定
    /// 「开始往坚果云或磁盘第二处写文件」，而它是对外写操作，必须由用户按下开关。
    #[serde(default)]
    pub cloud: Option<MdSyncCloud>,
}

/// 老配置（V0.4.0~V0.11.2 保存的 JSON）里没有 `pollSecs`，按默认 15 分钟补。
fn default_poll_secs() -> u64 {
    MD_SYNC_POLL_SECS
}

impl Default for MdSyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            poll_secs: MD_SYNC_POLL_SECS,
            bindings: default_bindings(),
            cloud: None,
        }
    }
}

impl MdSyncConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(MD_SYNC_POLL_MIN_SECS..=MD_SYNC_POLL_MAX_SECS).contains(&self.poll_secs) {
            return Err(format!(
                "同步间隔要在 {MD_SYNC_POLL_MIN_SECS} 秒到 {MD_SYNC_POLL_MAX_SECS} 秒之间"
            ));
        }
        if self.bindings.len() > MD_SYNC_MAX_BINDINGS {
            return Err(format!("最多 {MD_SYNC_MAX_BINDINGS} 个落点"));
        }
        let mut seen = std::collections::HashSet::new();
        let mut kinds = std::collections::HashSet::new();
        for (index, binding) in self.bindings.iter().enumerate() {
            binding
                .validate()
                .map_err(|err| format!("第 {} 个落点：{err}", index + 1))?;
            if !seen.insert(binding.key()) {
                return Err(format!("第 {} 个落点与前面的配置重复", index + 1));
            }
            /* 每个数据种类只有一个落点：设置页按 kind 找状态，多落点会显示串。
            真要多落点时应改成按 binding id 匹配。 */
            if !kinds.insert(binding.kind) {
                return Err(format!(
                    "第 {} 个落点重复了「{}」：每个数据种类只能有一个落点",
                    index + 1,
                    binding.kind.label()
                ));
            }
        }
        /* 云端通道的校验合一：路径不能与落点重合（两个写者）、WebDAV 必填项要齐。
        放在最后是因为它的错误文案最长、也最不常触发，先报「间隔不对」更符合用户
        从上到下改设置页的顺序。 */
        if let Some(cloud) = &self.cloud {
            cloud.validate(&self.bindings)?;
        }
        Ok(())
    }
}
