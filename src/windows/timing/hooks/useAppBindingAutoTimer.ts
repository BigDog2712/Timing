/**
 * 「切到绑定了事项的应用，就自动接管计时」（[0.13] 主人口径）。
 *
 * 原话：「在绑定事项的应用首次开启时，自动结束当前计时，并以应用绑定事项开始计时」。
 *
 * ## 接线
 *
 * Rust 追踪引擎在前台窗口**真的变了**时 `emit` 一次 `active-window-changed`
 * （`runtime.rs` 的 `did_change_active_window` 分支 —— 每秒轮询里只有变化才发，
 * 所以"首次进入这个应用"天然就是一次事件，不需要前端自己去重时间窗）。药丸常驻主窗，
 * 订阅一次即可。
 *
 * ## 三条边界
 *
 *   1. **同一个应用只接管一次**：`lastKeyRef` 记上一次处理的键。窗口标题变了、或者同一应用
 *      连发两次（引擎侧策略变化）都不该重复 `switch` —— 那会把用户刚手动切到别的事项的
 *      计时又拽回去。
 *   2. **正在计这个事项就什么都不做**：`startOrSwitch` 自己也会判，但这里先判一次是为了
 *      不白打两次 IPC（`list_items_for_app` 之后还有一次 `get_timer_state` 收敛）。
 *   3. **失败只 `console.warn`**：自动行为不该弹错误框。用户没点任何东西，弹一句
 *      "开始计时失败"只会让人困惑；真正的失败（比如事项已被删除）下一次手动操作会暴露。
 *
 * ## 为什么用 `startOrSwitch` 而不是 `stop + start`
 *
 * `startOrSwitch` 对 running 的处理是「先 pause 冻结累计，再 `switch(end_and_start)` 分段」
 * ——这正是"结束当前计时、以新事项开始"的语义（后端只接受非运行中会话做 switch，见
 * `useTimerActions` 的注释）。直接 `stop` 会额外产生一条"已结束记录 + 一条新记录"的
 * 观感差异（历史页会看到两段），而分段是用户本来就在做的事。
 */
import { useRef } from "react";

import { normalizeAppKey } from "../../shared/appKey.ts";
import { ACTIVE_WINDOW_CHANGED_EVENT, readActiveWindowExe } from "../../shared/hostEvents.ts";
import { useTauriEvent } from "./useTauriEvent";
import { useTimerActions } from "./useTimerActions";
import { ipc } from "../services/ipc";
import { useTimerStore } from "../stores/timerStore";

/** 一条 `item_app` 绑定（只取这里要用的两列：`ipc.listItemsForApp` 的返回是它的超集） */
export interface BoundItemRef {
  itemId: number;
  track?: number;
}

/**
 * 从某个应用的全部绑定里挑出"该接管的那一个"。
 *
 * 只认 `track === 1`（0 = 仅观察、不计入子记录，见 `models/item_app.rs`）；多条时取
 * `itemId` **最小**的那条 —— 必须有一个确定答案，否则"同一个应用绑了两个事项"会让
 * 结果取决于数据库返回顺序（用户看到的是"有时候切过去计的是 A，有时候是 B"）。
 */
export function pickBoundItemId(bindings: readonly BoundItemRef[]): number | null {
  let picked: number | null = null;
  for (const binding of bindings) {
    if (binding.track !== undefined && binding.track !== 1) continue;
    if (!Number.isSafeInteger(binding.itemId) || binding.itemId <= 0) continue;
    if (picked === null || binding.itemId < picked) picked = binding.itemId;
  }
  return picked;
}

export function useAppBindingAutoTimer(): void {
  const { startOrSwitch } = useTimerActions();
  const lastKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useTauriEvent<unknown>(ACTIVE_WINDOW_CHANGED_EVENT, (payload) => {
    const appKey = normalizeAppKey(readActiveWindowExe(payload) ?? "");
    if (!appKey) return;
    /* 同一应用重复广播：不重复接管（手动切走之后不该被拽回来） */
    if (lastKeyRef.current === appKey) return;
    /* 上一次还在查绑定：这一条丢掉（下一次前台变化会再来），别让两条并发 switch 打架 */
    if (inFlightRef.current) return;
    lastKeyRef.current = appKey;
    inFlightRef.current = true;

    void (async () => {
      try {
        const bindings = await ipc.listItemsForApp({ appKey });
        const itemId = pickBoundItemId(bindings as readonly BoundItemRef[]);
        if (itemId === null) return;
        const current = useTimerStore.getState().state;
        if (current.status !== "idle" && current.session?.itemId === itemId) return;
        await startOrSwitch(itemId);
      } catch (error) {
        /* 自动接管失败不打扰用户：没点任何东西却弹一句错误只会让人困惑 */
        console.warn("auto timer for bound app failed", appKey, error);
      } finally {
        inFlightRef.current = false;
      }
    })();
  });
}
