/**
 * TickBar — 瞬时 UI store（面板 / 菜单 / 收起 / 撤销条 / 恢复对话框 / 提示）
 * -----------------------------------------------------------------------------
 * 只承载**跨组件的瞬时界面状态**；业务数据在 timer/item/settings store。
 * 撤销窗口严格等于 UNDO_WINDOW_MS（domain.ts，与 IPC-CONTRACT-v2 §8 同源）。
 */
import { create } from 'zustand';
import { UNDO_WINDOW_MS } from '../types/domain';
import type { ReminderTarget, TimeRecord } from '../types/domain';

export type PanelKind = 'none' | 'create' | 'records' | 'settings';

export interface Notice {
  text: string;
  tone: 'info' | 'danger';
}

export interface MenuPos {
  x: number;
  y: number;
}

/** 倒计时菜单状态（批2 N-6）：锚点 + 可选目标事项（事项右键触发时带上该事项） */
export interface CountdownMenuState {
  pos: MenuPos;
  itemId?: number | null;
}

/** 提醒浮出卡状态（批2 N-5）：设置态（选时间）/ 到时态（reminder-fired） */export interface FiredReminderItem {
  target: ReminderTarget;
  targetId: number;
  title: string;
  remindAt: number;
}

export interface ReminderPopoverState {
  pos: MenuPos;
  mode: 'set' | 'fired';
  target: ReminderTarget;
  targetId: number;
  title: string;
  /** 到时态：±60s 聚合的到点条目（单卡承载，AC-61 不弹 N 张） */
  fired?: FiredReminderItem[];
  /** 设置态：既有提醒时刻（epoch ms）；null/省略 = 无 */
  remindAt?: number | null;
}

interface UiStore {
  /** 当前展开的面板（互斥，同一时刻至多一个） */
  panel: PanelKind;
  /** 是否收起为圆点 */
  collapsed: boolean;
  /** 上下文菜单是否开启 */
  menuOpen: boolean;
  /** 上下文菜单位置（层内坐标，逻辑像素） */
  menuPos: MenuPos;
  /** 启动时检测到的 active 会话（非空则弹恢复对话框） */
  recover: TimeRecord | null;
  /** 当前可撤销的已保存记录 */
  undoRecord: TimeRecord | null;
  /** 撤销窗口截止时间戳（epoch ms） */
  undoDeadline: number | null;
  /** 结束态视觉确认触发时间戳（900ms 后回 idle 视觉） */
  endedAt: number | null;
  /** 顶部/底部提示条 */
  notice: Notice | null;
  /* [批2 N-6/N-5/N-7] 主窗三个浮层（互斥 anchor，各自独立开关） */
  /** 倒计时菜单锚点（非空 = 展开） */
  countdownPos: CountdownMenuState | null;
  /** 常用事项菜单锚点（非空 = 展开） */
  commonItemsPos: MenuPos | null;
  /** 提醒浮出卡（非空 = 展示；mode 区分设置 / 到时） */
  reminderPopover: ReminderPopoverState | null;

  openPanel: (panel: Exclude<PanelKind, 'none'>) => void;
  closePanel: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  openMenu: (pos: MenuPos) => void;
  closeMenu: () => void;
  setRecover: (session: TimeRecord | null) => void;
  beginUndo: (record: TimeRecord) => void;
  clearUndo: () => void;
  flashEnded: () => void;
  setNotice: (notice: Notice | null) => void;
  /* [批2] 浮层开关 */
  openCountdownMenu: (state: CountdownMenuState) => void;
  closeCountdownMenu: () => void;
  openCommonItems: (pos: MenuPos) => void;
  closeCommonItems: () => void;
  openReminderPopover: (state: ReminderPopoverState) => void;
  closeReminderPopover: () => void;
  /** 托盘/显隐事件后重置瞬时 UI（收起面板与菜单） */
  resetTransient: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  panel: 'none',
  collapsed: false,
  menuOpen: false,
  menuPos: { x: 0, y: 0 },
  recover: null,
  undoRecord: null,
  undoDeadline: null,
  endedAt: null,
  notice: null,
  countdownPos: null,
  commonItemsPos: null,
  reminderPopover: null,

  openPanel: (panel) => set({ panel, menuOpen: false, countdownPos: null, commonItemsPos: null }),
  closePanel: () => set({ panel: 'none' }),
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleCollapsed: () =>
    set((s) => ({ collapsed: !s.collapsed, panel: 'none', menuOpen: false, countdownPos: null, commonItemsPos: null })),
  openMenu: (menuPos) => set({ menuOpen: true, menuPos, panel: 'none', countdownPos: null, commonItemsPos: null }),
  closeMenu: () => set({ menuOpen: false }),
  setRecover: (recover) => set({ recover }),
  beginUndo: (undoRecord) => set({ undoRecord, undoDeadline: Date.now() + UNDO_WINDOW_MS }),
  clearUndo: () => set({ undoRecord: null, undoDeadline: null }),
  flashEnded: () => set({ endedAt: Date.now() }),
  setNotice: (notice) => set({ notice }),
  openCountdownMenu: (state) => set({ countdownPos: state, menuOpen: false, commonItemsPos: null, panel: 'none' }),
  closeCountdownMenu: () => set({ countdownPos: null }),
  openCommonItems: (pos) => set({ commonItemsPos: pos, menuOpen: false, countdownPos: null, panel: 'none' }),
  closeCommonItems: () => set({ commonItemsPos: null }),
  openReminderPopover: (state) => set({ reminderPopover: state }),
  closeReminderPopover: () => set({ reminderPopover: null }),
  resetTransient: () => set({ panel: 'none', menuOpen: false, countdownPos: null, commonItemsPos: null }),
}));
