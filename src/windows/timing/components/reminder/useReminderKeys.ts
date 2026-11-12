/**
 * Timing — 提醒浮出卡键盘路径（reminder-popover.md §3.6）
 * -----------------------------------------------------------------------------
 * `Enter` 触发主动作；`Esc` 关闭（记录「未处理」）；`S` 快捷「稍后」。
 * handler 经 ref 转发，订阅只随挂载建立一次（与 useTauriEvent 同思路）。
 */
import { useEffect, useRef } from 'react';

interface ReminderKeys {
  onEscape: () => void;
  onEnter: () => void;
  onSnooze: () => void;
}

export function useReminderKeys({ onEscape, onEnter, onSnooze }: ReminderKeys): void {
  const ref = useRef({ onEscape, onEnter, onSnooze });
  ref.current = { onEscape, onEnter, onSnooze };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // 输入控件（如便利贴/选择框）里的按键不劫持
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        ref.current.onEscape();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        ref.current.onEnter();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        ref.current.onSnooze();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
