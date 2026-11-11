import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { addLocalDays, startOfLocalDay } from "../../shared/lib/localDate.ts";

/**
 * 宿主计时状态桥（P0-04）：分析窗读**宿主**的计时状态，读不到就什么都不显示。
 *
 * ## 为什么不新开命令 / 不新开事件
 *
 * 宿主每次计时状态迁移都会 `app.emit(TIMER_STATE_CHANGED, &state)`（`src-tauri/src/app/events.rs:46-52`），
 * `app.emit` 是**全窗广播**——分析窗本来就能收到，只是过去没人订阅（`theme-changed` 是同一个套路，
 * 见 `hostThemeGateway.ts:28-33` 的注释）。所以「每秒同步」不需要任何轮询、也不需要对表：
 * 两窗读的是同一份 `TimerState`，公式也同一份（见 `computeHostLiveSec`）。
 *
 * 事件名 `timer:state-changed` 在前端另有一份声明：宿主窗的 `IPC_EVENTS.timerStateChanged`
 * （`src/types/domain/ipc.ts:84`）。**两份必须逐字一致**（L9 禁止跨窗 import），
 * 后端常量在 `src-tauri/src/app/events.rs:12`。
 *
 * `get_timer_state` 只用于**冷启动补一次**：分析窗 WebView 首次创建时，宿主的计时可能早就跑起来了，
 * 那一帧广播已经过去了、且之后不会再发 —— 只靠订阅会让胶囊在「本次会话开始前」永远空白。
 * 它是**只读**命令，不破坏 `patina-host-bridge.toml` 的「不给任何写命令」边界。
 */
const TIMER_STATE_CHANGED = "timer:state-changed";
const GET_TIMER_STATE = "get_timer_state";
const LIST_RECORDS = "list_records";

/** 今日记录一次取这么多：一天的计时记录是几十条量级，500 是「不可能不够」的量。 */
const TODAY_RECORD_LIMIT = 500;

export type HostTimerStatus = "idle" | "running" | "paused";

/** 宿主 `TimeRecord` 里本功能用到的字段（camelCase，与 `models/record.rs` 的 serde 对齐）。 */
export interface HostTimerSession {
  id: number;
  itemId: number;
  accumulatedSec: number;
  /** 本次运行段起点；`null` = 不在跑（暂停/已结束） */
  runningSince: number | null;
}

/** 宿主 `TimerState` 的镜像（`src-tauri/src/models/timer.rs:15-28`）。 */
export interface HostTimerSnapshot {
  status: HostTimerStatus;
  session: HostTimerSession | null;
  lastItemId: number | null;
  liveDurationSec: number;
  mode: string;
  remainingSec: number | null;
}

/** 浏览器（vite 单跑 / 单测）里没有 Tauri 注入对象：直接判否，别让 invoke/listen 抛。 */
const isTauriRuntime = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function asStatus(value: unknown): HostTimerStatus | null {
  return value === "idle" || value === "running" || value === "paused" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 会话快照的形状校验：任何一个关键字段坏掉就当「没有会话」，而不是造一个半真的对象。 */
function asSession(value: unknown): HostTimerSession | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = asNumber(raw.id);
  const itemId = asNumber(raw.itemId);
  if (id === null || itemId === null) return null;
  const runningSince = asNumber(raw.runningSince);
  return {
    id,
    itemId,
    accumulatedSec: asNumber(raw.accumulatedSec) ?? 0,
    runningSince: runningSince !== null && runningSince > 0 ? runningSince : null,
  };
}

/** 载荷 → 快照。`status` 不认识就整体作废（宁可这一帧不更新，也不要显示一个假状态）。 */
export function asHostTimerSnapshot(value: unknown): HostTimerSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const status = asStatus(raw.status);
  if (status === null) return null;
  const lastItemId = asNumber(raw.lastItemId);
  const remainingSec = asNumber(raw.remainingSec);
  return {
    status,
    session: status === "idle" ? null : asSession(raw.session),
    lastItemId,
    liveDurationSec: asNumber(raw.liveDurationSec) ?? 0,
    mode: typeof raw.mode === "string" ? raw.mode : "countup",
    remainingSec,
  };
}

/**
 * 实时累计秒 —— **与宿主逐字同一公式**（IPC-CONTRACT-v2 §4.2）：
 *
 *   liveSec = accumulatedSec + (runningSince == null ? 0 : floor((now - runningSince) / 1000))
 *
 * 宿主实现在 `src/hooks/useTimerTick.ts:11-21`（`computeLiveSec`）。L9 禁止分析窗 import 它，
 * 所以这里照抄一份；`nowMs` 由调用方的 tick 传入，两窗因此用的是**同一毫秒**语义。
 * 负差值（系统时钟回拨）按 0 处理 —— 照抄宿主，否则用户会看到计时倒着走。
 */
export function computeHostLiveSec(
  accumulatedSec: number,
  runningSince: number | null,
  nowMs: number,
): number {
  const base = Number.isFinite(accumulatedSec) ? accumulatedSec : 0;
  if (runningSince === null) return base;
  const deltaMs = nowMs - runningSince;
  return base + (deltaMs > 0 ? Math.floor(deltaMs / 1000) : 0);
}

/** 冷启动补一次当前状态；读不到返回 null（调用方保持「未知」，胶囊不渲染）。 */
export async function readHostTimerSnapshot(): Promise<HostTimerSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    return asHostTimerSnapshot(await invoke<unknown>(GET_TIMER_STATE));
  } catch (error) {
    console.warn("[timer] read host timer state failed", error);
    return null;
  }
}

/**
 * 订阅宿主的计时状态广播。非法载荷**跳过这一帧**（不影响后续帧）。
 * 订阅失败返回 null（没有事件也还能靠 `readHostTimerSnapshot` 的初值显示静态时长）。
 */
export async function subscribeHostTimerState(
  onSnapshot: (snapshot: HostTimerSnapshot) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await listen<unknown>(TIMER_STATE_CHANGED, (event) => {
      const snapshot = asHostTimerSnapshot(event.payload);
      if (snapshot !== null) onSnapshot(snapshot);
    });
  } catch (error) {
    console.warn("[timer] subscribe host timer state failed", error);
    return null;
  }
}

interface RawRecordRow {
  accumulatedSec?: unknown;
  /** `null` = 这条记录还没结束（= 当前会话，滚动/暂停都算） */
  endedAt?: unknown;
}

/**
 * 今日**已封存**记录的累计秒（只算 `endedAt != null` 的）。
 *
 * 为什么不直接返回「今日总秒」：调用方还要显示当前会话的实时时长，而当前会话那条记录
 * 「尚未结束」也在今日区间里。若把它的 `accumulatedSec` 也加进来，再叠一个实时秒就
 * 重复计了。所以这里只给**已封存**的部分，调用方算 `settledSec + liveSec` 即得今日累计，
 * 并且能跟着每秒 tick 一起长——不会出现「已计时在跳、今日累计冻着」的观感。
 *
 * 为什么不用 `stats_summary`：`patina-host-bridge.toml` 只放行 `list_records` / `list_items`
 * （+ 本轮加的只读 `get_timer_state`），为一行数字去扩权限不值得。
 *
 * 读不到返回 null（胶囊只显示已计时），不抛给界面（§6.5：分析窗不承担宿主错误文案）。
 */
export async function readHostTodaySettledSec(nowMs: number): Promise<number | null> {
  if (!isTauriRuntime()) return null;
  const dayStart = startOfLocalDay(new Date(nowMs));
  try {
    const page = await invoke<{ items?: RawRecordRow[] } | null>(LIST_RECORDS, {
      from: dayStart.getTime(),
      to: addLocalDays(dayStart, 1).getTime(),
      limit: TODAY_RECORD_LIMIT,
    });
    const rows = page?.items ?? [];
    let total = 0;
    for (const row of rows) {
      /* 未结束的那条就是当前会话，交给调用方的 `liveSec` 去算 */
      if (row.endedAt === null || row.endedAt === undefined) continue;
      if (typeof row.accumulatedSec === "number" && Number.isFinite(row.accumulatedSec)) {
        total += row.accumulatedSec;
      }
    }
    return total;
  } catch (error) {
    console.warn("[timer] read host today total failed", error);
    return null;
  }
}
