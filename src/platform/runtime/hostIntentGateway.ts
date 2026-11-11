import { emitTo } from "@tauri-apps/api/event";

import { HOST_INTENT } from "./insightEvents.ts";

/**
 * 分析窗 → 药丸（label = `main`）的**意图**通道（P0-04 / P0-05，FUSION-ARCH-v1 §6.4）。
 *
 * ## 为什么是「意图」而不是「命令」
 *
 * `src-tauri/permissions/patina-host-bridge.toml` 的边界是：分析窗只能**读**宿主的账
 * （`list_records` / `list_items` / `get_timer_state`），**一条写命令都没有**。所以分析窗
 * 想「开始计时 / 暂停 / 打开设置」时不能自己 `invoke`——它只把「我想干什么」喊出去，
 * 由**药丸前端**（`src/services/hostIntentBridge.ts`）用它自己的 typed IPC 执行并落库。
 * Rust 侧对这条通道完全不知情，命令表与事件表都不动。
 *
 * ## 一个方向、一个事件名
 *
 * 所有「分析窗想让宿主做事」都走这一个事件，禁止每功能一个事件名（否则事件表迟早失控）。
 * 载荷是下面这个可辨识联合；**没有返回值**——分析窗不 await 结果、也不承担宿主的错误文案，
 * 成败由随后的 `timer:state-changed` 广播自然收敛（§6.5）。
 *
 * ## 窗口 label 反着写，别记错
 *
 * 药丸的 label 是 `"main"`；分析窗的 label 是 `"patina"`（与 Rust insight 侧
 * `MAIN_WINDOW_LABEL = "patina"` 的语义相反）。所以「发给药丸」= `emitTo("main", …)`。
 */
const PILL_WINDOW_LABEL = "main";

export type HostIntent =
  /** 对一段活动「在 Timing 计这件事」：`itemName` 由宿主按名精确匹配，没有就新建 */
  | { action: "start_timer_for_activity"; itemName: string }
  /** 把一段**过去**的活动补记为一条已完成的计时记录（P1-01）。判别式只有一句（§3.4）：
   *  payload 带不带 `startedAt`/`endedAt` —— 带 = 补记，不带 = 从现在开始。**不要**与上面
   *  那条合并：合并会让 P0-05「从此刻开始、不回填历史区间」在协议层失效。 */
  | { action: "backfill_record"; itemName: string; startedAt: number; endedAt: number }
  /** 暂停 ⇄ 继续：方向由**药丸**读自身状态决定（分析窗不该猜） */
  | { action: "toggle_timer" }
  /** 跳到宿主设置页（P0-06 的「主色在 Timing 设置里统一配置」用） */
  | { action: "open_host_settings" }
  /** 唤起并高亮药丸 */
  | { action: "show_pill" }
  /** 打开独立待办窗（今日概览待办卡点行体，02 P0-8）。走事件桥而不是新 IPC 命令：
   *  契约 81 个数字不动、L9 不破；待办窗本来就是药丸侧（宿主）的单例窗 */
  | { action: "open_todos" }
  /* ── [P3 · 0.12.1] 组件化仪表盘的四条唤起动作 ──
   * 全部走同一座事件桥（`patina:host-intent`），命令/事件/错误码一个不动。
   * **锚点口径**：分析窗拿不到药丸的屏幕坐标（跨窗坐标换算要读窗口几何，还得处理 DPI），
   * 所以这三条菜单意图一律落到药丸内容区左上角 `{x:12,y:12}`。观感是「菜单从条上弹出来」，
   * 与用户自己右键弹出的位置不同，但落点确定、不闪烁、不需要新命令。 */
  | { action: "open_items_menu" }
  | { action: "open_common_items" }
  | { action: "open_moyu_menu" }
  /** 打开某张便利贴（`note-{id}` 单例窗）；id 不存在时宿主侧静默忽略 */
  | { action: "open_note"; noteId: number };

/**
 * 发一条意图。返回「有没有发出去」——**不是**「宿主做成了没有」。
 *
 * 发失败只 `console.warn`：这条通道没有回执，向上抛只会让点一下活动段弹一个用户看不懂的错；
 * 真正的失败（建事项/开始计时被拒）由药丸侧 `setNotice` 呈现（§6.5）。
 */
export async function emitHostIntent(intent: HostIntent): Promise<boolean> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  try {
    await emitTo(PILL_WINDOW_LABEL, HOST_INTENT, intent);
    return true;
  } catch (error) {
    console.warn("[intent] emit host intent failed", intent.action, error);
    return false;
  }
}
