/**
 * Timing — 分析窗（insight）事件名常量（与后端 `models/insight/events.rs` 同名同值）
 * -----------------------------------------------------------------------------
 * 后端那 14 处 emit 与前端这些 listen 在归一前都是字符串字面量：改名靠全仓搜索，
 * 拼错则「监听永不触发」且没有任何门禁看着。T03 把它们收成常量，T04 的 contract
 * 检查再把「后端常量 ↔ 前端常量」钉死。
 *
 * 只收**前端真的在 listen** 的 7 个：`POWER_LIFECYCLE_CHANGED` / `POWER_WATCHER_READY`
 * 是 Rust 内部事件，前端没有对应监听，写进来只会变成死常量。
 */

/** 分析窗设置变更（`emitAppSettingsChanged` 也用它发）。 */
export const APP_SETTINGS_CHANGED = 'app-settings-changed';
/** 应用图标变更（图标缓存回填后广播）。 */
export const APP_ICON_CHANGED = 'app-icon-changed';
/** 当前活动窗口变更。 */
export const ACTIVE_WINDOW_CHANGED = 'active-window-changed';
/** 跟踪数据变更（会话 / 网页活动落库后）。 */
export const TRACKING_DATA_CHANGED = 'tracking-data-changed';
/** 主窗工具分区跳转目标（后端 `emit_to("patina", …)`）。 */
export const MAIN_TOOLS_TARGET_CHANGED = 'main-tools-target-changed';
/** 迷你窗状态快照（后端 `emit_to("mini", …)`）。 */
export const MINI_WINDOW_STATE = 'mini-window-state';
/** 工具浮层展示快照（`toolNotificationGateway` 监听）。 */
export const TOOL_PRESENTATION_CHANGED = 'tool-presentation-changed';

/**
 * [P0-05] 分析窗 → 药丸（label = `main`）的**意图**事件（FUSION-ARCH-v1 §6.4）。
 *
 * ⚠️ 它**只由前端 `emitTo` 发出**，Rust 侧完全不 emit、也完全不知情。因此**绝对不能**
 * 写进宿主的 `IPC_EVENTS`（`src/types/domain/ipc.ts:83`）——`scripts/check-contract.mjs:282-287`
 * 会把「前端声明了、后端没有 emit 点」判成死常量直接红。契约里的事件数保持 11 不变。
 *
 * 对侧常量在宿主 `src/services/hostIntentBridge.ts` 顶部（L9 禁止跨窗 import，
 * 两边各写一份，改一处必须改两处）。
 */
export const HOST_INTENT = 'patina:host-intent';

