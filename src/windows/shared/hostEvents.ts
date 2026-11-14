/**
 * 前台应用的「事实键」——`active-window-changed` 的事件名与载荷里的 `exe_name`（[0.13]）。
 *
 * 为什么要有这一层：主窗（药丸）要监听追踪引擎广播的前台窗口变化，但事件名常量原来只写在
 * 分析窗的 `platform/runtime/insightEvents.ts` 里（那是 Patina 子树，L9 禁止主窗 import）。
 * 主窗如果直接写字符串字面量，改名时没有任何东西会红 —— 症状是「切到绑定的应用不计时」，
 * 而两端日志都干净。
 *
 * 所以：常量放在 `src/windows/shared/`（两窗都能引用的第三棵树），并由
 * `useAppBindingAutoTimer.test.ts` 的 source test 对照 Rust 的
 * `models::insight/events.rs` 钉住字面值。
 */

/** Rust `models::insight::events::ACTIVE_WINDOW_CHANGED` 的字面值 */
export const ACTIVE_WINDOW_CHANGED_EVENT = "active-window-changed";

/**
 * 从事件载荷里取前台进程名。
 *
 * 载荷是 `RawTrackingWindowSnapshot`（snake_case，`exe_name: string`）。这里**不**做完整
 * 校验：缺字段时返回 `null` 由调用方跳过，比"解析失败就抛"更合适 —— 那条广播每秒最多一次，
 * 抛异常会把控制台刷满。
 */
export function readActiveWindowExe(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { exe_name?: unknown }).exe_name;
  return typeof value === "string" ? value : null;
}
