/**
 * TickBar — 收起圆点 CollapsedDot（collapsed.md）
 * -----------------------------------------------------------------------------
 * 可见直径 28px、环描边 2.5px（面积缩小加粗补偿）；命中区 36x36（< 44 的偏差已
 * 在 DESIGN.md §8.3 说明）。单击展开回药丸；右键单击弹上下文菜单；
 * hover 300ms 后原生 title 显示「时长 · 事项名」。
 */
import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ENDED_FLASH_MS } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { useTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';

export function CollapsedDot() {
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const endedAt = useUiStore((s) => s.endedAt);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  const openMenu = useUiStore((s) => s.openMenu);

  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (endedAt == null) return;
    setEnded(true);
    const id = window.setTimeout(() => setEnded(false), ENDED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [endedAt]);

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const name = findItem(items, currentItemId)?.name ?? '未归类';
  const tooltip = `${formatDuration(seconds)} · ${name}`;

  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <button
      type="button"
      className="dot"
      data-state={visual}
      title={tooltip}
      aria-label={`收起状态：${tooltip}，单击展开`}
      onClick={toggleCollapsed}
      onContextMenu={handleContextMenu}
    >
      <span className="dot__ring" aria-hidden />
    </button>
  );
}
