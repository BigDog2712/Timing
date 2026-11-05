/**
 * Timing — 计时状态 store（前端只渲染，Rust 为单一事实来源）
 * -----------------------------------------------------------------------------
 * `state` 为 TimerState 快照，来源二选一：
 *   1. `timer:state-changed` 事件 payload（权威，直接覆盖）；
 *   2. 命令返回后主动 `refresh()`（拉取 get_timer_state）。
 * 前端本地 tick 由 hooks/useTimerTick 基于 session.runningSince 推算（R-4 同公式）。
 */
import { create } from 'zustand';
import { timerApi } from '../services/api';
import { SYSTEM_ITEM_ID } from '../types/domain';
import type { TimerState } from '../types/domain';

export const IDLE_TIMER_STATE: TimerState = {
  status: 'idle',
  session: null,
  lastItemId: SYSTEM_ITEM_ID,
  liveDurationSec: 0,
  /* [V0.2.0] idle 时模式为 countup、无剩余秒（ARCHITECTURE-V0.2.0 §5.4） */
  mode: 'countup',
  remainingSec: null,
};

interface TimerStore {
  state: TimerState;
  loaded: boolean;
  /** 以事件 payload 覆盖本地状态（权威） */
  setState: (state: TimerState) => void;
  /**
   * 乐观翻状态（暂停 ⇄ 继续）。
   * 暂停/继续的 IPC 往返约 30ms，这段时间里 `status` 还是旧值——暂停后立刻右键数字
   * 会因「仍算 running」被吞掉（用户口径：「开启暂停的一瞬间唤不出摸鱼菜单」）。
   * 先本地认账，再由随后的事件 / `refresh()` 收口；失败路径会 refresh 回真值。
   */
  setStatus: (status: TimerState['status']) => void;
  /** 主动拉取 get_timer_state 并覆盖本地状态 */
  refresh: () => Promise<TimerState>;
}

/** 请求代次：只让**最新**那一次 `refresh` 写状态 */
let seq = 0;

export const useTimerStore = create<TimerStore>((set, get) => ({
  state: IDLE_TIMER_STATE,
  loaded: false,
  setState: (state) => {
    /* 事件推来的快照比任何在途 refresh 都新：自增代次，让旧请求回来时自动作废 */
    seq += 1;
    set({ state, loaded: true });
  },
  setStatus: (status) => set((store) => ({ state: { ...store.state, status } })),
  refresh: async (): Promise<TimerState> => {
    /* [V0.11.2] 乱序保护：倒计时到点的事件刷新与用户点「结束」触发的刷新可能并发，
       较早发出但较晚到达的那次会把旧状态写回（表现为「结束完又跳回计时中」）。
       代次不匹配就丢弃，返回当前已生效的状态。 */
    const mine = ++seq;
    const state = await timerApi.state();
    if (mine !== seq) return get().state;
    set({ state, loaded: true });
    return state;
  },
}));
