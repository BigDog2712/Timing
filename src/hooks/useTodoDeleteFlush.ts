/**
 * TickBar — 待办未决删除兜底提交（AC-32 乐观删除）
 * -----------------------------------------------------------------------------
 * 撤销窗内若发生「窗口隐藏 / 最小化（visibilitychange=hidden）/ 应用退出（beforeunload）」
 * → 立即提交未决删除，避免「删了没提交」。
 * 说明：**不监听窗口失焦事件**（原「失焦即提交」已按评审移除）。事项窗可见时由 store 的
 *      3s setTimeout 正常提交；若失焦即提交，撤销窗会被收窄成「一离开焦点」——用户删错后
 *      点了别处就撤不回，反而削弱 AC-32「提供短时可撤销」。故仅保留真正会导致「不提交」的两条路径。
 * （其他待办变更的提交由 todoStore 各变更动作内部负责。）
 * 仅事项窗挂载；卸载即兜底提交一次（非 Tauri 无害：无 pending 时为空操作）。
 */
import { useEffect } from 'react';
import { useTodoStore } from '../stores/todoStore';

export function useTodoDeleteFlush(): void {
  useEffect(() => {
    const flush = () => {
      void useTodoStore.getState().commitPending();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);
}
