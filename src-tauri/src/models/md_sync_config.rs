//! 同步配置结构（V0.4.0 起；V0.11.3 从 `md_sync.rs` 拆出）。
//!
//! 为什么单独一个文件：`md_sync.rs` 里还放着种类枚举、落点、运行状态、报告等六七种结构，
//! 加上 V0.11.3 的 `poll_secs` 之后越过 300 行硬约束。配置是最独立的一块——
//! 它只依赖「落点」和四个常量，搬出来不需要动别人的调用点（`md_sync.rs` 里 re-export）。

use serde::{Deserialize, Serialize};

use crate::models::constants::{MD_SYNC_POLL_MAX_SECS, MD_SYNC_POLL_MIN_SECS, MD_SYNC_POLL_SECS};
use crate::models::md_sync::{MdSyncBinding, MD_SYNC_MAX_BINDINGS};

/// 最终生效的同步配置（用户保存过就以保存值为准）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// [V0.11.3] 自动同步间隔（秒）。缺省读老配置时补默认值，不因新增字段让老 JSON 解析失败。
    #[serde(default = "default_poll_secs")]
    pub poll_secs: u64,
    #[serde(default)]
    pub bindings: Vec<MdSyncBinding>,
}

/// 老配置（V0.4.0~V0.11.2 保存的 JSON）里没有 `pollSecs`，按默认 15 分钟补。
fn default_poll_secs() -> u64 {
    MD_SYNC_POLL_SECS
}

/// 总开关缺省为开：插件装了就该工作。
fn default_true() -> bool {
    true
}

impl Default for MdSyncConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poll_secs: MD_SYNC_POLL_SECS,
            bindings: Vec::new(),
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
            /* v2 每个数据种类只有一个落点：设置页按 kind 找状态，多落点会显示串。
            真要多落点时应升 API 版本并改成按 binding id 匹配。 */
            if !kinds.insert(binding.kind) {
                return Err(format!(
                    "第 {} 个落点重复了「{}」：每个数据种类只能有一个落点",
                    index + 1,
                    binding.kind.label()
                ));
            }
        }
        Ok(())
    }
}
