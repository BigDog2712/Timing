/**
 * Timing — 瞬时 UI store（面板 / 菜单 / 收起 / 撤销条 / 恢复对话框 / 提示）
 * -----------------------------------------------------------------------------
 * 只承载**跨组件的瞬时界面状态**；业务数据在 timer/item/settings store。
 * 撤销窗口严格等于 UNDO_WINDOW_MS（domain.ts，与 IPC-CONTRACT-v2 §8 同源）。
 */
import { create } from 'zustand';
import { UNDO_WINDOW_MS } from '../types/domain';
import type { ReminderTarget, TimeRecord, TodoNudge } from '../types/domain';

export type PanelKind = 'none' | 'create' | 'records' | 'settings' | 'digest';

export interface Notice {
  text: string;
  tone: 'info' | 'danger';
}

export interface MenuPos {
  x: number;
  y: number;
  /**
   * [V0.3.1] 触发面板的那个「条」在布局坐标下的上下沿（可选）。
   *
   * 浮层竖直方向默认贴锚点展开，但菜单是从鼠标位置弹的，锚点在条**内部**——
   * 紧贴小条展开时会盖住小条本身（实测盖住 20px，小条只剩下半截）。
   * 主菜单带上它之后，下方展开贴条的下沿、翻到上方贴条的上沿，条永远完整可见。
   */
  bar?: { top: number; bottom: number };
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

/**
 * [V0.3.2] 摸鱼菜单（暂停态右键时间 / 点事项名）：锚点 + 可选的当前事项。
 *
 * 菜单内容来自插件贡献的 `quickTimers`（见 `usePluginStore`），
 * 所以这里只存「在哪儿弹」，不存菜单项本身。
 */
export interface MoyuMenuState {
  pos: MenuPos;
  itemId?: number | null;
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
  mode: 'set' | 'fired' | 'nudge';
  target: ReminderTarget;
  targetId: number;
  title: string;
  /** 到时态：±60s 聚合的到点条目（单卡承载，AC-61 不弹 N 张） */
  fired?: FiredReminderItem[];
  /** 设置态：既有提醒时刻（epoch ms）；null/省略 = 无 */
  remindAt?: number | null;
  /** [V0.3.12] 待办两级提醒态（stage=1 轻提醒 / stage=2 自动开始询问，ADR-030） */
  nudge?: TodoNudge;
}

interface UiStore {
  /** 当前展开的面板（互斥，同一时刻至多一个） */
  panel: PanelKind;
  /** 是否收起为圆点 */
  collapsed: boolean;
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
  /* [批2 N-6/N-5] 主窗两个浮层（互斥 anchor，各自独立开关） */
  /** 倒计时菜单锚点（非空 = 展开） */
  countdownPos: CountdownMenuState | null;
  countdownCardPos: MenuPos | null;
  /** 提醒浮出卡（非空 = 展示；mode 区分设置 / 到时） */
  reminderPopover: ReminderPopoverState | null;
  /** [V0.2.1] 便利贴清单锚点（手柄右键唤出；非空 = 展开） */
  notesListPos: MenuPos | null;
  /** [V0.2.3] 事项菜单（事项名右键；非空 = 展开） */
  itemMenu: ItemMenuState | null;
  /** [V0.3.2] 摸鱼菜单（暂停态唤出；非空 = 展开） */
  moyuPos: MoyuMenuState | null;
  /**
   * [V0.3.9] 常用事项框（计时中 / 暂停态左键事项名；非空 = 展开）。
   * 只存锚点：置顶 / 最近编辑都从 itemStore + settings 现算，不复制一份快照。
   */
  commonItemsPos: MenuPos | null;
  /** [V0.2.3] 小条内联命名（非空 = 条上直接编辑名称） */
  inlineEdit: InlineEditState | null;
  /** [V0.3.1] 高亮定位触发序号（托盘双击 → +1；小条据此闪一下） */
  highlightSeq: number;

  openPanel: (panel: Exclude<PanelKind, 'none'>) => void;
  closePanel: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
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
  /* [V0.3.2] 摸鱼菜单 */
  openMoyuMenu: (state: MoyuMenuState) => void;
  closeMoyuMenu: () => void;
  /* [V0.3.9] 常用事项框 */
  openCommonItems: (pos: MenuPos) => void;
  /**
   * [V0.3.9] 空闲态点事项组件：**新建输入框 + 常用事项框一起出**（用户口径）。
   * 单开任何一个都会因为 `CLOSED` 铺底把另一个顶掉，所以合在一个 action 里。
   */
  openCommonItemsNew: (pos: MenuPos) => void;
  closeCommonItems: () => void;
  /** 托盘/显隐事件后重置瞬时 UI（收起面板与菜单） */
  resetTransient: () => void;
  /** [V0.3.1] 托盘双击：小条高亮闪一下（序号自增，组件按变化触发） */
  flashHighlight: () => void;
}

/**
 * 所有「浮层类」瞬时状态的关闭形态：任一新浮层开启时先铺这一份，再覆盖自己要开的那个字段。
 * 集中一处是为了不再逐个手写 `xxx: null`（[V0.2.3] 新增事项菜单 / 内联命名后，漏清会叠层）。
 */
const CLOSED = {
  panel: 'none' as PanelKind,
  countdownPos: null,
  countdownCardPos: null,
  notesListPos: null,
  itemMenu: null,
  moyuPos: null,
  commonItemsPos: null,
  inlineEdit: null,
};

export const useUiStore = create<UiStore>((set) => ({
  panel: 'none',
  collapsed: false,
  recover: null,
  undoRecord: null,
  undoDeadline: null,
  endedAt: null,
  notice: null,
  countdownPos: null,
  countdownCardPos: null,
  reminderPopover: null,
  notesListPos: null,
  itemMenu: null,
  moyuPos: null,
  commonItemsPos: null,
  inlineEdit: null,
  highlightSeq: 0,

  openPanel: (panel) => set({ ...CLOSED, panel }),
  closePanel: () => set({ panel: 'none' }),
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleCollapsed: () => set((s) => ({ ...CLOSED, collapsed: !s.collapsed })),
  setRecover: (recover) => set({ recover }),
  beginUndo: (undoRecord) => set({ undoRecord, undoDeadline: Date.now() + UNDO_WINDOW_MS }),
  clearUndo: () => set({ undoRecord: null, undoDeadline: null }),
  flashEnded: () => set({ endedAt: Date.now() }),
  setNotice: (notice) => set({ notice }),
  openCountdownCard: (pos) => set({ ...CLOSED, countdownCardPos: pos }),
  closeCountdownCard: () => set({ countdownCardPos: null }),
  openCountdownMenu: (state) => set({ ...CLOSED, countdownPos: state }),
  closeCountdownMenu: () => set({ countdownPos: null }),
  /* 提醒卡也是浮层：不铺 CLOSED 时它会被开着的主菜单/面板顶在下面叠层，
     关掉其中一个还会留另一个（[V0.2.11] 与其余 open* 对齐） */
  openReminderPopover: (state) => set({ ...CLOSED, reminderPopover: state }),
  closeReminderPopover: () => set({ reminderPopover: null }),
  openNotesList: (pos) => set({ ...CLOSED, notesListPos: pos }),
  closeNotesList: () => set({ notesListPos: null }),
  openItemMenu: (state) => set({ ...CLOSED, itemMenu: state }),
  closeItemMenu: () => set({ itemMenu: null }),
  openMoyuMenu: (state) => set({ ...CLOSED, moyuPos: state }),
  closeMoyuMenu: () => set({ moyuPos: null }),
  openCommonItems: (pos) => set({ ...CLOSED, commonItemsPos: pos }),
  openCommonItemsNew: (pos) => set({ ...CLOSED, commonItemsPos: pos, inlineEdit: { itemId: null, initial: '' } }),
  closeCommonItems: () => set({ commonItemsPos: null }),
  openInlineEdit: (state) => set({ ...CLOSED, inlineEdit: state }),
  closeInlineEdit: () => set({ inlineEdit: null }),
  /* 失焦 / 托盘切换后窗口不再可交互：提醒卡也要收。
     notice / undoRecord / recover 刻意保留——前两个有自己的计时，恢复框等用户决策。 */
  resetTransient: () => set({ ...CLOSED, reminderPopover: null }),
  flashHighlight: () => set((s) => ({ highlightSeq: s.highlightSeq + 1 })),
}));
