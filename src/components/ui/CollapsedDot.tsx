/**
 * Timing — 收起圆点 CollapsedDot（collapsed.md）
 * -----------------------------------------------------------------------------
 * 可见直径 28px、环描边 2.5px（面积缩小加粗补偿）；命中区 36x36（< 44 的偏差已
 * 在 DESIGN.md §8.3 说明）。单击展开回药丸；右键不再弹任何菜单（V0.3.1）；
 * hover 300ms 后原生 title 显示「时长 · 事项名」。
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import { formatDuration } from '../../lib/format';
import { useEndedFlash } from '../../hooks/useEndedFlash';
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
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);

  /* 结束态 900ms（与药丸同源）：窗口判定在 hook 里，折叠→展开不会重放旧时间戳 */
  const ended = useEndedFlash();

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const name = findItem(items, currentItemId)?.name ?? '未归类';
  const tooltip = `${formatDuration(seconds)} · ${name}`;

  /* [V0.3.1] 右键主菜单已删除：圆点右键只吞事件，不再弹菜单 */
  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
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
