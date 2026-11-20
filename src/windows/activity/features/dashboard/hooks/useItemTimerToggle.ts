/**
 * 合并卡「事项」· 上区行的**点击起停**（0.12.6 · T4）
 * =============================================================================
 * 一行两件事：① 这份「当前会话挂在哪个事项上」的只读事实（行上的红点与 `aria-label`
 * 靠它）；② 一次点击该发哪一条意图。
 *
 * ## 为什么方向在**发信侧**判，而不是发一条 toggle
 *
 * 药丸侧本来有 `toggle_timer`（方向由它读自身状态决定）。这里不用它：
 * `toggle_timer` 不带事项 —— 用户在 A 行点一下，药丸会接着计 `lastItemId`（可能是 B），
 * 症状是"点了 A 却在计 B"，而且看起来像生效了。所以两条独立意图：
 *
 *   · 正在计**这一条** → `stop_timer`（不带载荷：方向信息不该夹在行程里）；
 *   · 其余一律 → `start_timer_for_item`（药丸侧走 `startOrSwitch`：空闲就开，
 *     在计别的就先暂停冻结累计再分段切过去，暂停在别的事项上就直接切）。
 *
 * 暂停中的同一事项也走 `start_timer_for_item` —— `startOrSwitch` 对"点的是当前这一条
 * 且暂停着"的实现就是 `runTogglePause`（继续），语义正好是用户要的。
 *
 * ## 为什么不做乐观切换
 *
 * 分析窗没有写命令（`activity-host-bridge.toml`），发出去的只是意图，**没有回执**。
 * 本地先翻状态会在失败时留下一个"看起来在计、其实没计"的假象，而随后那一帧
 * `timer:state-changed` 又会把它翻回去 —— 一秒钟内跳两下，比不跳更糟。
 * 所以：点了什么都不改，等宿主的广播来收敛（§6.5 跨窗只传意图，不传错误）。
 *
 * ## 连点为什么不产生第二条记录（两重保险）
 *
 *   ① 本文件 `busyRef`：一发一收之间再点，直接丢弃；
 *   ② 药丸侧 `startOrSwitch` 对"当前就是这一条且正在跑"返回 true 而不新建记录 ——
 *      即使广播比点击慢，第二次也会落进这个分支。
 * 第一重挡的是"响两次"，第二重挡的是"多一条记录"，两件事都得挡。
 *
 * ## 提示只在**宿主确认之后**出
 *
 * 「已开始计时 / 已停止」这两句承诺的是**结果**，而结果只有广播知道。
 * 所以点击时只挂一个"我在等什么"的备忘录（`pendingRef`），下一帧广播对上了才提示；
 * 对不上（例如药丸拒绝了）就静静清掉，不编一句成功。失败由药丸的 `setNotice` 呈现。
 *
 * ## 为什么「停」的提示**不**说"已记录"（M6）
 *
 * 这里的判据只有一条：会话离开了这一条（`sessionItemId !== pending.itemId`）。宿主还有
 * 第二个事实 —— 这段是不是短到被丢弃（`StopResult.discarded`，低于「最短记录时长」时
 * 后端软删除，药丸自己会飘一句「不足 X 秒，未记录」，见
 * `windows/timing/hooks/useTimerActions.ts:149`）—— 但那个事实**只存在于药丸进程**：
 * 我们发出去的 `stop_timer` 是意图、没有回执，回来的是 `timer:state-changed` 广播，
 * 而广播的载荷 `TimerState`（`hostTimerGateway.HostTimerSnapshot`）里没有这个字段。
 * 也就是说：分析窗**拿不到**这个事实，写成"已结束计时：X"就是在替宿主保证"记上了"，
 * 而用户可能刚看到药丸说"不足 5 秒，未记录" —— 两句话互相打脸。
 * 所以文案退到只报动作（`itemsTimerStopped` = 「已停止：{name}」）。
 * 要说得更准就得给跨窗契约加字段（`TimerState` + `events.rs`），那不在这张卡的范围里。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "../../../shared/i18n/index.ts";
import type { ToastPush } from "../../../shared/types/toast.ts";
import {
  readHostTimerSnapshot,
  subscribeHostTimerState,
  type HostTimerSnapshot,
  type HostTimerStatus,
} from "../../../platform/runtime/hostTimerGateway.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import { TIMELINE_MANAGE_COPY } from "../copyTimeline.ts";

export interface ItemTimerToggle {
  /** 宿主计时状态（`idle` 时 `sessionItemId` 必为 `null`） */
  status: HostTimerStatus;
  /**
   * 当前会话挂在哪个事项上。**暂停中的会话也算**（点它应当是"继续"），
   * 但行上要不要画"正在计时"的红点只认 `status === "running"`。
   */
  sessionItemId: number | null;
  /** 行点击：同一事项且正在跑 → 结束；其余一律「开始 / 切过去」 */
  toggleItem: (itemId: number, name: string) => void;
}

/**
 * 没有宿主时的空实现（卡片单测 / 浏览器里单跑 vite）。
 * 行照样可聚焦可读，点下去什么都不发 —— 比"绑一个会抛的回调"安全。
 */
export const IDLE_ITEM_TIMER: ItemTimerToggle = {
  status: "idle",
  sessionItemId: null,
  toggleItem: (): void => undefined,
};

/** 状态 + 会话的复合键：暂停→继续（同一个事项、状态变了）也算一次迁移。 */
function snapshotKey(snapshot: HostTimerSnapshot | null): string {
  if (!snapshot) return "unknown";
  return `${snapshot.status}:${snapshot.session?.itemId ?? -1}`;
}

/** 一次点击在等什么。`wantStop = false` 时等"这个事项变成当前会话"。 */
interface PendingClick {
  itemId: number;
  name: string;
  wantStop: boolean;
}

export function useItemTimerToggle(onToast: ToastPush): ItemTimerToggle {
  const copy = TIMELINE_MANAGE_COPY[useLocale()];
  const [snapshot, setSnapshot] = useState<HostTimerSnapshot | null>(null);
  const snapshotRef = useRef<HostTimerSnapshot | null>(null);
  const keyRef = useRef<string>("unknown");
  const busyRef = useRef(false);
  const pendingRef = useRef<PendingClick | null>(null);

  /* 订阅只挂一次（依赖为空），所以回调里读的文案与提示出口要经过这个"最新值"盒子；
     否则切一次语言就得多订阅一次，而重订阅的窗口期里会漏帧。 */
  const latest = useRef({ copy, onToast });
  useEffect(() => {
    latest.current = { copy, onToast };
  }, [copy, onToast]);

  /** 新的一帧宿主状态：先落状态，再结算"我在等的那一次点击"。 */
  const applySnapshot = useCallback((next: HostTimerSnapshot | null) => {
    snapshotRef.current = next;
    setSnapshot(next);
    const key = snapshotKey(next);
    if (key === keyRef.current) return;
    keyRef.current = key;

    const pending = pendingRef.current;
    if (!pending) return;
    /* 一次性：不管对不对得上都清掉，绝不让一条过期的期待在下一次迁移上误报成功 */
    pendingRef.current = null;
    const sessionItemId = next && next.status !== "idle" ? next.session?.itemId ?? null : null;
    const { copy: text, onToast: push } = latest.current;
    if (pending.wantStop) {
      /* 会话离开这一条（结束 / 切走）就说一声；还挂着说明药丸没停，不出声。
         **只报"停了"**：这段有没有被丢弃（`discarded`）不在这条广播里，见文件头 M6 那段。 */
      if (sessionItemId !== pending.itemId) push(text.itemsTimerStopped(pending.name), "success");
      return;
    }
    if (sessionItemId === pending.itemId) push(text.itemsTimerStarted(pending.name), "success");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void readHostTimerSnapshot().then((initial) => {
      if (cancelled) return;
      /* 冷启动补一帧：分析窗首次创建时宿主的计时可能早就跑起来了，那一帧广播已经过去 */
      snapshotRef.current = initial;
      keyRef.current = snapshotKey(initial);
      setSnapshot(initial);
    });

    void subscribeHostTimerState((next) => applySnapshot(next)).then((fn) => {
      if (cancelled) {
        fn?.();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applySnapshot]);

  const toggleItem = useCallback((itemId: number, name: string) => {
    if (busyRef.current) return;
    const current = snapshotRef.current;
    const sessionItemId = current && current.status !== "idle" ? current.session?.itemId ?? null : null;
    const wantStop = current?.status === "running" && sessionItemId === itemId;

    busyRef.current = true;
    pendingRef.current = { itemId, name, wantStop };
    const intent = wantStop
      ? ({ action: "stop_timer" } as const)
      : ({ action: "start_timer_for_item", itemId } as const);

    void emitHostIntent(intent).then((sent) => {
      busyRef.current = false;
      if (sent) return;
      /* 没发出去 = 连"我想干什么"都没到药丸：这不是宿主的错误，是桥断了，说一句让人再点 */
      pendingRef.current = null;
      latest.current.onToast(latest.current.copy.itemsTimerSendFailed, "error");
    });
  }, []);

  const status: HostTimerStatus = snapshot?.status ?? "idle";
  const sessionItemId = status === "idle" ? null : snapshot?.session?.itemId ?? null;

  return { status, sessionItemId, toggleItem };
}
