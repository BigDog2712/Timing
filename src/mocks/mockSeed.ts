/**
 * TickBar — 浏览器降级 Mock：种子数据与状态构造
 * -----------------------------------------------------------------------------
 * 与 browserMock.ts 配套（后者只放命令处理器）。语义对齐 IPC-CONTRACT-v2：
 * 错误以 `{ code, message }` 的 rejected value 抛出。**不参与生产**。
 */
import type { Item, Note, Reminder, Settings, TimeRecord, TimerState, Todo } from '../types/domain';
import { DEFAULT_COUNTDOWN_PRESETS } from '../types/domain';

export const now = () => Date.now();

function sampleRecords(): TimeRecord[] {
  const base = now() - 4 * 3600 * 1000;
  const mk = (id: number, itemId: number, offsetMin: number, durSec: number): TimeRecord => ({
    id,
    itemId,
    status: 'saved',
    startedAt: base + offsetMin * 60 * 1000,
    endedAt: base + offsetMin * 60 * 1000 + durSec * 1000,
    accumulatedSec: durSec,
    runningSince: null,
    note: null,
    /* [V0.2.0] */
    mode: 'countup',
    targetSec: null,
  });
  return [
    mk(101, 2, 0, 2102),
    mk(102, 2, 60, 2702),
    mk(103, 3, 130, 3490),
    mk(104, 4, 210, 2644),
    mk(105, 1, 300, 1200),
  ];
}

const DEFAULT_SETTINGS: Settings = {
  autostartEnabled: false,
  alwaysOnTop: true,
  opacityEnabled: true,
  lastDisplayId: null,
  shortcuts: { toggleWindow: null, startPause: null, stop: null, newItem: null },
  /* [V0.2.0] */
  themeMode: 'dark',
  accents: { running: '#4DA3E8', warn: '#E8A33D', done: '#4CC38A', bar: null },
  countdownPresets: [...DEFAULT_COUNTDOWN_PRESETS],
  /* [V0.2.0 批2] 到点「自动结束并保存」默认关（AC-62） */
  countdownAutoEnd: false,
};

export interface MockState {
  items: Item[];
  records: TimeRecord[];
  active: TimeRecord | null;
  settings: Settings;
  lastItemId: number;
  seq: number;
  /* [V0.2.0] 新增资源（待办 / 便利贴 / 提醒） */
  todos: Todo[];
  notes: Note[];
  reminders: Reminder[];
}

/** 构造初始状态（含「未归类」系统事项与示例记录） */
export function seed(): MockState {
  const t = now();
  return {
    items: [
      { id: 1, name: '未归类', color: null, status: 'active', isSystem: true, sortOrder: 0, remindAt: null, remindedAt: null, isPinned: false, createdAt: t, updatedAt: t },
      { id: 2, name: '品牌视觉改版', color: null, status: 'active', isSystem: false, sortOrder: 1, remindAt: null, remindedAt: null, isPinned: true, createdAt: t, updatedAt: t },
      { id: 3, name: '客户方案评审', color: null, status: 'active', isSystem: false, sortOrder: 2, remindAt: null, remindedAt: null, isPinned: false, createdAt: t, updatedAt: t },
      { id: 4, name: '接口联调', color: null, status: 'active', isSystem: false, sortOrder: 3, remindAt: null, remindedAt: null, isPinned: false, createdAt: t, updatedAt: t },
    ],
    records: sampleRecords(),
    active: null,
    settings: { ...DEFAULT_SETTINGS },
    lastItemId: 2,
    seq: 200,
    todos: [
      { id: 301, title: '整理本周时间周报', plannedAt: t + 3600 * 1000, remindAt: null, remindedAt: null, doneAt: null, sortOrder: 0, createdAt: t, updatedAt: t },
      { id: 302, title: '给客户回邮件', plannedAt: null, remindAt: null, remindedAt: null, doneAt: null, sortOrder: 1, createdAt: t, updatedAt: t },
    ],
    notes: [],
    reminders: [],
  };
}

/** 依据内部状态构造 TimerState（与 get_timer_state 同公式） */
export function buildState(s: MockState): TimerState {
  const session = s.active;
  let live = 0;
  let status: TimerState['status'] = 'idle';
  if (session) {
    status = session.runningSince != null ? 'running' : 'paused';
    const delta = session.runningSince != null ? Math.floor((now() - session.runningSince) / 1000) : 0;
    live = session.accumulatedSec + delta;
  }
  /* [V0.2.0] 倒计时剩余（与 get_timer_state 同口径） */
  const mode = session?.mode ?? 'countup';
  const remainingSec =
    session?.mode === 'countdown' && session.targetSec != null ? Math.max(0, session.targetSec - live) : null;
  return { status, session, lastItemId: s.lastItemId, liveDurationSec: live, mode, remainingSec };
}

/** 抛出规范化错误（{ code, message }） */
export function fail(code: string, message: string): never {
  throw { code, message };
}
