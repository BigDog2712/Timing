//! DDL 文本（`include_str!`，不占 Rust 行数、不撞单文件 300 行的棘轮）。
//!
//! 这里只放**内核自己要用**的文本：设备维度的迁移正文。历史版本 1–27 的正文仍在
//! `data/schema.rs` 的常量里（它们的 checksum 已经写进用户的账本，动不得），
//! 由 `data/schema_registry.rs` 统一登记。

/// `patina.db` 设备维度迁移的正文（与 `data/sql/0028_device_dimension.sql` 同一份文件）。
pub const DEVICE_DIMENSION_SQL: &str = include_str!("../data/sql/0028_device_dimension.sql");
