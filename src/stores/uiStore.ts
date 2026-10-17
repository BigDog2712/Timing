/**
 * TickBar — 瞬时 UI store（面板 / 菜单 / 收起 / 撤销条 / 恢复对话框 / 提示）
 * -----------------------------------------------------------------------------
 * 只承载**跨组件的瞬时界面状态**；业务数据在 timer/item/settings store。
 * 撤销窗口严格等于 UNDO_WINDOW_MS（domain.ts，与 IPC-CONTRACT-v2 §8 同源）。
 */
import { create } from 'zustand';
import { UNDO_WINDOW_MS } from '../types/domain';
import type { ReminderTarget, TimeRecord } from '../types/domain';

export type PanelKind = 'none' | 'create' | 'records' | 'settings' | 'digest';

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
  /** Time-zone right-click opens the editor directly. */
  custom?: boolean;
}

/** [V0.2.3 · 4] 事项菜单（右键事项名）：锚点 + 目标事项 */
export interface ItemMenuState {
  pos: MenuPos;
  itemId: number | null;
}

/** [V0.2.3 · 3] 小条内联命名（左键事项 = 快捷添加；itemId 非空 = 改这条的名字） */
export interface InlineEditState {
  /** null = 新建事项；非空 = 重命名该事项 */
  itemId: number | null;
  /** 进入时的初始文本（重命名用；新建留空） */
  initial: string;
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
  countdownCardPos: MenuPos | null;
  /** 常用事项菜单锚点（非空 = 展开） */
  commonItemsPos: MenuPos | null;
  /** 提醒浮出卡（非空 = 展示；mode 区分设置 / 到时） */
  reminderPopover: ReminderPopoverState | null;
  /** [V0.2.1] 便利贴清单锚点（手柄右键唤出；非空 = 展开） */
  notesListPos: MenuPos | null;
  /** [V0.2.3] 事项菜单（事项名右键；非空 = 展开） */
  itemMenu: ItemMenuState | null;
  /** [V0.2.3] 小条内联命名（非空 = 条上直接编辑名称） */
  inlineEdit: InlineEditState | null;

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
  openCountdownCard: (pos: MenuPos) => void;
  closeCountdownCard: () => void;
  openCountdownMenu: (state: CountdownMenuState) => void;
  closeCountdownMenu: () => void;
  openCommonItems: (pos: MenuPos) => void;
  closeCommonItems: () => void;
  openReminderPopover: (state: ReminderPopoverState) => void;
  closeReminderPopover: () => void;
  /* [V0.2.1] 便利贴清单 */
  openNotesList: (pos: MenuPos) => void;
  closeNotesList: () => void;
  /* [V0.2.3] 事项菜单 + 内联命名 */
  openItemMenu: (state: ItemMenuState) => void;
  closeItemMenu: () => void;
  openInlineEdit: (state: InlineEditState) => void;
  closeInlineEdit: () => void;
  /** 托盘/显隐事件后重置瞬时 UI（收起面板与菜单） */
  resetTransient: () => void;
}

/**
 * 所有「浮层类」瞬时状态的关闭形态：任一新浮层开启时先铺这一份，再覆盖自己要开的那个字段。
 * 集中一处是为了不再逐个手写 `xxx: null`（[V0.2.3] 新增事项菜单 / 内联命名后，漏清会叠层）。
 */
const CLOSED = {
  panel: 'none' as PanelKind,
  menuOpen: false,
  countdownPos: null,
  countdownCardPos: null,
  commonItemsPos: null,
  notesListPos: null,
  itemMenu: null,
  inlineEdit: null,
};

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
  countdownCardPos: null,
  commonItemsPos: null,
  reminderPopover: null,
  notesListPos: null,
  itemMenu: null,
  inlineEdit: null,

  openPanel: (panel) => set({ ...CLOSED, panel }),
  closePanel: () => set({ panel: 'none' }),
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleCollapsed: () => set((s) => ({ ...CLOSED, collapsed: !s.collapsed })),
  openMenu: (menuPos) => set({ ...CLOSED, menuOpen: true, menuPos }),
  closeMenu: () => set({ menuOpen: false }),
  setRecover: (recover) => set({ recover }),
  beginUndo: (undoRecord) => set({ undoRecord, undoDeadline: Date.now() + UNDO_WINDOW_MS }),
  clearUndo: () => set({ undoRecord: null, undoDeadline: null }),
  flashEnded: () => set({ endedAt: Date.now() }),
  setNotice: (notice) => set({ notice }),
  openCountdownCard: (pos) => set({ ...CLOSED, countdownCardPos: pos }),
  closeCountdownCard: () => set({ countdownCardPos: null }),
  openCountdownMenu: (state) => set({ ...CLOSED, countdownPos: state }),
  closeCountdownMenu: () => set({ countdownPos: null }),
  openCommonItems: (pos) => set({ ...CLOSED, commonItemsPos: pos }),
  closeCommonItems: () => set({ commonItemsPos: null }),
  openReminderPopover: (state) => set({ reminderPopover: state }),
  closeReminderPopover: () => set({ reminderPopover: null }),
  openNotesList: (pos) => set({ ...CLOSED, notesListPos: pos }),
  closeNotesList: () => set({ notesListPos: null }),
  openItemMenu: (state) => set({ ...CLOSED, itemMenu: state }),
  closeItemMenu: () => set({ itemMenu: null }),
  openInlineEdit: (state) => set({ ...CLOSED, inlineEdit: state }),
  closeInlineEdit: () => set({ inlineEdit: null }),
  resetTransient: () => set({ ...CLOSED }),
}));
