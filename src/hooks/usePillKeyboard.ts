/**
 * TickBar — 小条键盘分派（Space / Enter / Esc）
 * -----------------------------------------------------------------------------
 * 规则来自 Timing v1.7.3 的键盘对照：只有焦点在圆环上时 Space/Enter 才生效，
 * 避免在事项名输入框里按空格被当成开始/结束。Esc 只收浮层，不结束计时。
 * [V0.3.1] Menu 键 / Shift+F10 唤出主菜单的入口随主菜单一并删除。
 */
import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useUiStore } from '../stores/uiStore';
import type { TimerActions } from './useTimerActions';

export function usePillKeyboard(
  status: string,
  actions: Pick<TimerActions, 'togglePause' | 'stop'>,
  /** [V0.3.8] Space 的完整分派：暂停弹摸鱼菜单 / 继续收菜单（方向判定在回调内），与圆环左键同源 */
  onPause?: () => void,
): (e: ReactKeyboardEvent<HTMLDivElement>) => void {
  return useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const onRing = (e.target as HTMLElement).classList.contains('ring');
      if ((e.key === ' ' || e.key === 'Spacebar') && onRing) {
        e.preventDefault();
        if (!e.repeat) {
          /* 有连招回调 → 全方向交给它（暂停弹摸鱼菜单 / 继续收菜单，方向判定在 hook 内）；
             未传时退回裸 togglePause（向后兼容） */
          if (onPause) onPause();
          else void actions.togglePause();
        }
        return;
      }
      if (e.key === 'Enter' && onRing) {
        e.preventDefault();
        if (!e.repeat && status !== 'idle') void actions.stop();
        return;
      }
      if (e.key === 'Escape') {
        useUiStore.getState().closePanel();
      }
    },
    [status, actions, onPause],
  );
}
