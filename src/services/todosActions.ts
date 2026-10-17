/**
 * TickBar — 待办动作 + 事项窗口入口（菜单 / 事项窗共用；唯一改造待办的口径）
 * -----------------------------------------------------------------------------
 * - CRUD 一律经 todoStore（就地更新，避免整表重拉闪烁）。
 * - openTodosWindow()：Tauri → `open_todos_window`（宽 336 单例窗，ADR-009 §2）。
 *   非 Tauri（浏览器 dev 无多窗口）→ **回退为提示条**，不做内联伪窗。
 *   理由：主窗的面板位（PanelKind）只有 create/records/settings，无 todos 内联位；
 *   再塞一套内联待办 UI = 与独立窗形成两份实现，必然漂移，故选择「明确提示」而非静默无反应。
 */
import { ipc, isTauri } from './ipc';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';

export const todosActions = {
  create: (title: string, plannedAt?: number | null) => useTodoStore.getState().create(title, plannedAt),
  rename: (id: number, title: string) => useTodoStore.getState().rename(id, title),
  toggle: (id: number, done: boolean) => useTodoStore.getState().toggle(id, done),
  /** [AC-32] 乐观删除：本地立即移除并起撤销窗（**不**立即落库；见 todoStore.remove 注释） */
  remove: (id: number) => useTodoStore.getState().remove(id),
  reload: () => useTodoStore.getState().reload(),
};

/** 打开事项窗口：Tauri 独立窗（后端单例）；建窗失败 / 非 Tauri → 提示条兜底 */
export async function openTodosWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await ipc.openTodosWindow();
      return;
    } catch {
      /* 建窗失败（如 capabilities 未放行）→ 落到下方提示兜底，不静默吞点击 */
    }
  }
  useUiStore.getState().setNotice({ text: '事项窗口需在桌面版中打开', tone: 'info' });
}
