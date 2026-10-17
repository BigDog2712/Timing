/**
 * TickBar — 状态圆标记 TodoMark（todos-panel.md §1 状态标记）
 * -----------------------------------------------------------------------------
 * 尺寸 --todos-mark-size 15；未完成 = 1.5px 空圈（--todo-mark-ring）；
 * 完成 = --ok 实心 + 9px lucide `check`（--todo-mark-done-ink）——**不用 U+2713**。
 * 图形本身 aria-hidden；可勾选场景由外层 <button> 承载语义。
 */
import { CheckIcon } from '../../lib/icons';

interface TodoMarkProps {
  done: boolean;
  /** 进行中：环提亮（当前行） */
  current?: boolean;
}

export function TodoMark({ done, current = false }: TodoMarkProps) {
  return (
    <span
      className="todo-mark"
      data-done={done ? 'true' : 'false'}
      data-current={current ? 'true' : 'false'}
      aria-hidden
    >
      {done && <CheckIcon size={9} strokeWidth={3} />}
    </span>
  );
}
