/**
 * Timing — 移动壳的瞬时 UI store（Tab / 覆盖层 / 记录页刷新信号）
 * -----------------------------------------------------------------------------
 * 为什么不复用 `uiStore`：桌面那份承载的是「药丸 + 浮层锚点（x/y 坐标）」，
 * 手机没有锚点概念（一切覆盖层都是底部 Sheet），混在一起会让两边都要写
 * 「这个字段在对面是不是垃圾」的注释。
 *
 * 口径（DESIGN-ANDROID-V1 §7）：
 *   - Tab 五个（timer / items / records / notes / settings）——[V0.11.0] 补便利贴；
 *   - Sheet 是**覆盖层状态**，不进 Tab 栈：从任意页打开都盖在整壳之上，
 *     返回键先关它，再退 Tab（层级由 MobileShell 的 history 守卫实现）；
 *   - 记录页的编辑 Sheet 保存后要让列表立刻重算分布，所以这里只放一个自增信号，
 *     不把 `reload` 回调往 store 里塞（回调不是状态）。
 */
import { create } from 'zustand';
import type { TimeRecord } from '../types/domain';

export type MobileTab = 'timer' | 'items' | 'records' | 'notes' | 'settings';

/** 底部 Sheet 的载荷（每种 Sheet 自带它需要的那一条数据，避免二次拉取） */
export type MobileSheet =
  | { kind: 'countdown' }
  | { kind: 'switchItem' }
  | { kind: 'recordEdit'; record: TimeRecord }
  | { kind: 'itemMenu'; itemId: number }
  /**
   * 计时中点某条待办：先问「这段怎么收尾」（结束并新开 / 仅改归属）。
   * `title` 一起带过来：匹配事项、文案都要用，等待面板时不必再去 store 里找。
   */
  | { kind: 'todoSwitch'; todoId: number; title: string }
  /** [V0.11.0] 便利贴正文编辑（`noteId: null` = 新建一张，落库后由组件回填） */
  | { kind: 'noteEdit'; noteId: number | null }
  /** [V0.11.0] 便利贴改归属（选完成再回编辑页，故带上 noteId） */
  | { kind: 'noteItem'; noteId: number };

interface MobileUiStore {
  tab: MobileTab;
  sheet: MobileSheet | null;
  /** 记录页刷新信号：编辑 / 删除一条记录后自增 */
  recordsNonce: number;
  /**
   * [V0.11.2] 便利贴列表刷新信号：新建 / 编辑 / 删除后自增。
   * 编辑 Sheet 是覆盖层，`NotesPage` 始终挂载，不刷新就会一直显示旧内容。
   */
  notesNonce: number;
  /**
   * 系统通知不可用的原因（null = 没问题）。
   * `denied` = 用户拒绝授权；`unsupported` = 插件/能力缺失（打包配置问题）。
   * 两者都要**常驻**一条降级说明（不是一次 toast）：到点提醒改走应用内提示，
   * 这是对用户的承诺，静态变量不会触发重渲染，用户就看不到它。
   */
  notifyIssue: 'denied' | 'unsupported' | null;
  setTab: (tab: MobileTab) => void;
  openSheet: (sheet: MobileSheet) => void;
  /**
   * 关 Sheet。传 `kind` 时**只关这一种**：
   * 异步操作（落盘 / 落库 / 删记录）完成回来时，用户可能已经关掉原 Sheet 又开了另一张，
   * 无条件关闭会把新开的那张一起关掉（[V0.11.2]）。
   */
  closeSheet: (kind?: MobileSheet['kind']) => void;
  bumpRecords: () => void;
  bumpNotes: () => void;
  setNotifyIssue: (issue: 'denied' | 'unsupported' | null) => void;
}

export const useMobileUiStore = create<MobileUiStore>((set) => ({
  tab: 'timer',
  sheet: null,
  recordsNonce: 0,
  notesNonce: 0,
  notifyIssue: null,
  setTab: (tab) => set({ tab }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: (kind) =>
    set((s) => (kind != null && s.sheet?.kind !== kind ? s : { sheet: null })),
  bumpRecords: () => set((s) => ({ recordsNonce: s.recordsNonce + 1 })),
  bumpNotes: () => set((s) => ({ notesNonce: s.notesNonce + 1 })),
  setNotifyIssue: (notifyIssue) => set({ notifyIssue }),
}));
