//! 可移植 schema 内核（裁决 B）：**只碰 sqlx 与文件系统**，零 `AppHandle`。
//!
//! 抽它的理由不是「好看」，而是手机端要建 `patina.db` 却编不进整个
//! `services::insight::data`：那里 136 个 rs 文件里有 52 个直接引 `AppHandle`/`tauri::`、
//! 还有一批引用 `infra::insight`（整体 `#[cfg(desktop)]`）。把「建库」这件小事
//! 抽成 4 个文件，比把整层放开到两端便宜得多，而且**对 P3 的验收贡献是一样的**。
//!
//! ## 对外面只有三个函数
//!
//! - [`ensure_schema`]：把**任何**状态的库带到 head 28（Migrator + 幂等补列守卫）；
//! - [`adopt_local_rows`]：迁移期哨兵 `device_id = ''` → 真实 `install_id`，并补 `uid`；
//! - [`ensure_install_id`]：读/生成本机 12 位身份（入参是目录，不是 `AppHandle`）。
//!
//! ## 谁调它
//!
//! 桌面：`sqlite_pool::prepare_pool_schema`（在迁移历史归一化之后、启动验收之前）。
//! 手机：P3 的宿主命令 `activity_db_ensure`（本批次**不**新增，见 T09）。
//!
//! 两边共用同一份 DDL 文本（[`ddl`] 里的 `include_str!`），所以「先跑谁」无所谓：
//! `ensure_schema` 幂等，先跑一遍不会让后跑的一遍出错。

pub mod ddl;
pub mod device;
pub mod ensure;

pub use device::ensure_install_id;
pub use ensure::{adopt_business_rows, adopt_local_rows, ensure_schema_at};
#[cfg(test)]
mod version_guard_tests;
