/**
 * Timing — 移动壳的瞬时 UI store（Tab / 覆盖层 / 记录页刷新信号）
 * -----------------------------------------------------------------------------
 * 为什么不复用 `uiStore`：桌面那份承载的是「药丸 + 浮层锚点（x/y 坐标）」，
 * 手机没有锚点概念（一切覆盖层都是底部 Sheet），混在一起会让两边都要写
 * 「这个字段在对面是不是垃圾」的注释。
 *
 * 口径（DESIGN-ANDROID-V1 §7）：
 *   - Tab 只有 4 个（timer / items / records / settings）；
 *   - Sheet 是**覆盖层状态**，不进 Tab 栈：从任意页打开都盖在整壳之上，
 *     返回键先关它，再退 Tab（层级由 MobileShell 的 history 守卫实现）；
 *   - 记录页的编辑 Sheet 保存后要让列表立刻重算分布，所以这里只放一个自增信号，
 *     不把 `reload` 回调往 store 里塞（回调不是状态）。
 */
import { create } from 'zustand';
import type { TimeRecord } from '../types/domain';

export type MobileTab = 'timer' | 'items' | 'records' | 'settings';

/** 底部 Sheet 的载荷（每种 Sheet 自带它需要的那一条数据，避免二次拉取） */
export type MobileSheet =
  | { kind: 'countdown' }
  | { kind: 'switchItem' }
  | { kind: 'recordEdit'; record: TimeRecord }
  | { kind: 'itemMenu'; itemId: number };

interface MobileUiStore {
  tab: MobileTab;
  sheet: MobileSheet | null;
  /** 记录页刷新信号：编辑 / 删除一条记录后自增 */
  recordsNonce: number;
  /**
   * 系统通知不可用的原因（null = 没问题）。
   * `denied` = 用户拒绝授权；`unsupported` = 插件/能力缺失（打包配置问题）。
   * 两者都要**常驻**一条降级说明（不是一次 toast）：到点提醒改走应用内提示，
   * 这是对用户的承诺，静态变量不会触发重渲染，用户就看不到它。
   */
  notifyIssue: 'denied' | 'unsupported' | null;
  setTab: (tab: MobileTab) => void;
  openSheet: (sheet: MobileSheet) => void;
  closeSheet: () => void;
  bumpRecords: () => void;
  setNotifyIssue: (issue: 'denied' | 'unsupported' | null) => void;
}

export const useMobileUiStore = create<MobileUiStore>((set) => ({
  tab: 'timer',
  sheet: null,
  recordsNonce: 0,
  notifyIssue: null,
  setTab: (tab) => set({ tab }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  bumpRecords: () => set((s) => ({ recordsNonce: s.recordsNonce + 1 })),
  setNotifyIssue: (notifyIssue) => set({ notifyIssue }),
}));
