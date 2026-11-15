import { useEffect, useState } from "react";

import {
  computeHostLiveSec,
  readHostTimerSnapshot,
  readHostTodaySettledSec,
  subscribeHostTimerState,
  type HostTimerSession,
  type HostTimerSnapshot,
  type HostTimerStatus,
} from "../../platform/runtime/hostTimerGateway.ts";
import { loadTimingItemNames, type TimingItemName } from "../../platform/runtime/timingOverlapGateway.ts";

/**
 * 宿主计时状态的**唯一**分析窗读数源（P0-04）。
 *
 * ## 为什么不会有「两套计算」
 *
 * 数字有三层，每一层都只有一份：
 *  1. **状态**：宿主 `timer:state-changed` 广播的 `TimerState`（`app.emit` = 全窗，两窗同源）；
 *     冷启动补一次 `get_timer_state`。分析窗**不轮询、不自己维护状态机**。
 *  2. **公式**：`computeHostLiveSec`（`hostTimerGateway.ts`）与宿主 `useTimerTick.ts:11-21`
 *     的 `computeLiveSec` 逐字同式 —— `accumulatedSec + floor((now - runningSince)/1000)`。
 *  3. **时间轴**：本 hook 只负责「每过 1 秒把 `nowMs` 推进一次」，把 `nowMs` 交给上面那条公式。
 *     所以两窗任意时刻算出的秒数只可能差在**两次 `Date.now()` 之间**（< 1 个 tick），
 *     不可能各自累加出一套自己的数（那样一晚上就能漂几十秒）。
 *
 * ## 其它三条口径
 *   · **失败即静默**：IPC / ACL / 宿主库未就绪一律退化成「没有数据」，胶囊不渲染，不报错（§6.5）。
 *   · **未知不等于 idle**：`ready === false` 时 `status` 也是 `'idle'`，但调用方应看 `ready`，
 *     否则冷启动那一瞬会闪一下「没有计时」。
 *   · **卸载即取消**：`active` / `cancelled` 挡住「已经卸载了，订阅才建立成功」。
 */
export interface HostTimerView {
  status: HostTimerStatus;
  session: HostTimerSession | null;
  /** 当前会话已计时秒：running 时每秒跳，paused / idle 冻结（与宿主同式） */
  liveSec: number;
  /** 当前事项名（`list_items` 里查不到 → null） */
  itemName: string | null;
  /** 今日累计秒 = 今日已封存记录 + `liveSec`；宿主读不到 → null（界面只省掉这一段） */
  todaySec: number | null;
  /** 全部事项（含已归档）：「同名事项自动匹配」用（P0-05 弹卡） */
  items: TimingItemName[];
  /** 收到过至少一帧状态。false = 还不知道（别当成 idle） */
  ready: boolean;
}

export function useHostTimerState(): HostTimerView {
  const [snapshot, setSnapshot] = useState<HostTimerSnapshot | null>(null);
  const [items, setItems] = useState<TimingItemName[]>([]);
  const [settledSec, setSettledSec] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /* 广播计数（P1-01）。补记**不改计时状态**，所以「状态没变的那一帧」是这个 hook 唯一能
     感知「记录库变过了」的证据 —— 见下面第二个 effect 的依赖。 */
  const [revision, setRevision] = useState(0);

  /* **先订阅、后读**：读是异步的，顺序反了就丢掉两次之间的广播；而读回来的旧值若在新事件
     之后落地，会把新状态盖掉 —— `received` 就是拦这个的（与 `createHostThemeSync` 同一处理）。 */
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    let received = false;
    void (async () => {
      const stop = await subscribeHostTimerState((next) => {
        received = true;
        if (active) { setSnapshot(next); setRevision((n) => n + 1); }
      });
      if (!active) {
        stop?.();
        return;
      }
      unlisten = stop;
      const initial = await readHostTimerSnapshot();
      if (active && !received) setSnapshot(initial);
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const status: HostTimerStatus = snapshot?.status ?? "idle";
  const session = snapshot?.session ?? null;
  const sessionId = session?.id ?? null;

  /* 事项名与今日累计：只在**状态迁移**时重查（开/停/换/暂停），不跟每秒 tick 走。
     跟着 tick 每查一次 `list_records` 就是「看着能用、跑一天打十万次查询」。
     `revision` 是**补记**的唯一入口：补记不动状态，没有它胶囊的今日累计要等下一次状态迁移
     才 +N（用户点完补记盯 5 秒不动会报「没生效」）。消费方须幂等容忍「状态没变」那一帧。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [names, settled] = await Promise.all([
        loadTimingItemNames().catch(() => [] as TimingItemName[]),
        readHostTodaySettledSec(Date.now()),
      ]);
      if (cancelled) return;
      setItems(names);
      setSettledSec(settled);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, sessionId, revision]);

  const runningSince = session?.runningSince ?? null;

  /* 时间轴：只在真正在跑时打 tick。paused / idle 立刻停 —— 冻结的数字不需要定时器。 */
  useEffect(() => {
    setNowMs(Date.now());
    if (runningSince === null) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runningSince, sessionId, status]);

  const liveSec = computeHostLiveSec(
    session?.accumulatedSec ?? 0,
    runningSince,
    nowMs,
  );

  return {
    status,
    session,
    liveSec,
    itemName: session === null
      ? null
      : items.find((item) => item.id === session.itemId)?.name ?? null,
    todaySec: settledSec === null ? null : settledSec + liveSec,
    items,
    ready: snapshot !== null,
  };
}
