/**
 * Timing — 事项窗口行焦点导航（↑↓ 在 [data-row] 行间移动）
 * -----------------------------------------------------------------------------
 * todos-panel.md §3.4：↑↓ 在记录 / 待办行间移动。行元素带 data-row + tabIndex=0。
 */
import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';

export function useRowFocusNav() {
  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row]'));
    if (rows.length === 0) return;
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const from = current < 0 ? (delta > 0 ? -1 : 0) : current;
    const next = (from + delta + rows.length) % rows.length;
    rows[next]?.focus();
  }, []);
}
