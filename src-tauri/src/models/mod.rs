//! 领域模型 / DTO（字段一律 camelCase，与 `src/types/domain.ts` 严格对齐）。

pub mod common;
/* [V0.11.15] 数据根落点的对外形状（`dataRootGet` / `dataRootChange` 的返回）。 */
pub mod data_root;
pub mod constants;
pub mod enums;
pub mod item;
pub mod md_sync;
/* [V0.11.19] 云端自动同步三档（单独成文件：`md_sync_cloud.rs` 只剩 4 行余量）。 */
pub mod md_sync_auto;
/* [V0.11.19 变更 A] 往期清理的记账：六个 KV 键的唯一出处 + 状态投影。 */
pub mod md_cloud_purge;
pub mod md_sync_cloud;
pub mod md_sync_config;
/* [V0.11.16] 「测试连接」的三关结果（从 `md_sync_cloud.rs` 搬出，给那个文件腾门禁余量）。 */
pub mod md_sync_test_result;
pub mod migration;
pub mod moyu;
pub mod native;
pub mod note;
pub mod nudge;
pub mod plugin;
pub mod record;
pub mod reminder;
pub mod settings;
pub mod stats;
pub mod theme;
pub mod timer;
pub mod todo;
