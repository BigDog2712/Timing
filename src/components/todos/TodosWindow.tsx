/**
 * Timing — 独立事项窗（label = todos）
 * -----------------------------------------------------------------------------
 * 后端 open_todos_window 以 `decorations:false / transparent:true / visible:false`
 * 创建宽 --todos-w 336 的单例窗口（ADR-009 §2，高自适应）。本组件是该窗的根：
 *   1. 自订阅 theme-changed（主窗不代转，K-21）+ 首帧 theme_get/accent_get；
 *   2. 订阅 timer:state-changed 并拉取一次会话（「进行中」行需要实时时长）；
 *   3. 首帧就绪后自行 show（K-18 防白闪）。
 * 尺寸/透明底由 html[data-window="todos"] 与 .todos--window 承载（见 CSS）；
 * Esc 关窗（todos-panel.md §3.4）。
 */
import { useEffect } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { useTodoDeleteFlush } from '../../hooks/useTodoDeleteFlush';
import { useWindowLeaveHide } from '../../hooks/useWindowLeaveHide';
import { closeCurrentWindow, showCurrentWindowOnReady } from '../../lib/window';
import { themeActions } from '../../services/themeActions';
import { useItemStore } from '../../stores/itemStore';
import { useTodoStore } from '../../stores/todoStore';
import { useThemeStore } from '../../stores/themeStore';
import { useTimerStore } from '../../stores/timerStore';
import { IPC_EVENTS } from '../../types/domain';
import type { MdSyncReport, ThemeChangedPayload, TimerState } from '../../types/domain';
import { TodosPanel } from './TodosPanel';
import { Batch2Overlays } from '../Batch2Overlays';

export function TodosWindow() {
  /* AC-32 兜底：撤销窗内窗口隐藏 / 最小化 / 应用退出 → 立即提交未决删除 */
  useTodoDeleteFlush();

  /* [V0.2.8] 事项窗是浮层：指针离开窗口即隐藏（不销毁，再开即原位显示） */
  useWindowLeaveHide();

  /* 主题：本窗自订阅广播 */
  useTauriEvent<ThemeChangedPayload>(IPC_EVENTS.themeChanged, (payload) => {
    useThemeStore.getState().apply(payload.mode, payload.accents);
  });

  /* 计时状态：进行中行需要实时时长（本地 tick 基于 runningSince 推算） */
  useTauriEvent<TimerState>(IPC_EVENTS.timerStateChanged, (payload) => {
    useTimerStore.getState().setState(payload);
  });

  /* [V0.4.0] Markdown 导入可能新建事项 / 便利贴 / 改待办：重拉列表，避免本窗显示旧数据。 */
  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    const touched =
      report.kinds.includes('timers') ||
      report.kinds.includes('notes') ||
      report.kinds.includes('todos');
    if (!touched) return;
    void useItemStore.getState().reload().catch(() => undefined);
    void useTodoStore.getState().reload().catch(() => undefined);
  });

  /* 首帧读权威主题 + 四色 */
  useEffect(() => {
    let cancelled = false;
    void themeActions.init().catch(() => {
      if (!cancelled) useThemeStore.getState().markLoaded();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 首帧数据：事项名（记录行）+ 会话（进行中行） */
  useEffect(() => {
    void useItemStore.getState().reload().catch(() => undefined);
    void useTimerStore.getState().refresh().catch(() => undefined);
  }, []);

  /* [V0.3.12] 窗口重新获得焦点时重拉待办：主窗那边可能刚做过轻提醒的「推迟」、
     「现在就开始」或到点自动开始（这些都会改/删待办），不重拉这里就是一份陈旧列表。 */
  useEffect(() => {
    const onFocus = () => {
      void useTodoStore.getState().reload().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /* 首帧就绪后显示窗口（防白闪；cleanup 取消未执行的 rAF/定时器） */
  useEffect(() => showCurrentWindowOnReady(), []);

  return (
    <div className="win">
      <TodosPanel onRequestClose={() => void closeCurrentWindow()} />
      <Batch2Overlays />
    </div>
  );
}
