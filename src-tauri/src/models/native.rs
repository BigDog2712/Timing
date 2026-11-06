//! 移动端原生能力的 DTO（SAF 目录 / 悬浮条状态）。
//!
//! 与 `src/types/domain/mobile.ts` 逐字对应（`rename_all = "camelCase"`）。
//! 这些形状由 Kotlin 侧组装，Rust 只做一层反序列化，不参与计算。

/* 桌面这端没有原生桥，三个形状都无调用方（`commands/mobile_cmd_desktop.rs` 直接回错误）。 */
#![cfg_attr(desktop, allow(dead_code))]

use serde::{Deserialize, Serialize};

/// SAF 目录授权状态。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafStatus {
    /// 已选中目录且授权仍有效。用户撤销授权、删掉目录、换机之后都会变回 false。
    pub granted: bool,
    /// 给人看的目录名（`Documents/Obsidian/Vault · …`）。无授权时为空串。
    pub label: String,
}

/// 悬浮条状态。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStatus {
    /// 系统「显示在其他应用上层」权限是否已给。没有它，窗口根本贴不上去。
    pub permitted: bool,
    /// 用户是否打开过这个开关。**不代表服务在跑**：服务可能被厂商策略杀掉。
    pub enabled: bool,
}

/// 镜像结果：本轮真正从 SAF 复制进来的文件（相对路径）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorResult {
    /// 存在的文件才会出现在这里；不存在的路径说明「vault 里还没有今天的日记」。
    pub files: Vec<String>,
}
