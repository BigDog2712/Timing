/**
 * Timing — 移动端原生能力类型（V0.12.0）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/native.rs` 逐字对应（serde camelCase）。
 *
 * 这两个形状都由 Kotlin 侧组装（`TimingNativePlugin.kt`），Rust 只做一层反序列化。
 * 之所以不塞进 `mdSync.ts`：它们不是同步域的数据，而是「这台设备支不支持」的事实——
 * 桌面调这些命令一律回 `IO_ERROR`，前端靠它区分「没授权」和「这端没有这个功能」。
 */

/** SAF 目录授权状态 */
export interface SafStatus {
  /** 已选中目录且授权仍有效（撤销授权、删掉目录、换机之后都会变回 false） */
  granted: boolean;
  /** 给人看的目录名，如 `Obsidian、Timing · …`；未授权时为空串 */
  label: string;
}

/** 悬浮条状态 */
export interface OverlayStatus {
  /** 系统「显示在其他应用上层」权限是否已给。没有它，窗口根本贴不上去 */
  permitted: boolean;
  /** 用户是否打开过开关。**不代表服务在跑**：服务可能被厂商的后台策略杀掉 */
  enabled: boolean;
}
