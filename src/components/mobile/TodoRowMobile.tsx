/**
 * Timing — 移动端待办行
 * -----------------------------------------------------------------------------
 * 一行承担四个动作（PRD P0-6 / §4 ②）：
 *   点圆圈 = 完成 / 取消完成；点「开始」= 变成计时（`todo_start`，后端当场把待办移出）；
 *   **长按整行 = 删除**（乐观删除 + 3s 撤销条，与桌面 AC-32 同口径，不弹二次确认）。
 *
 * 长按只绑在文字区（不是整行）：右侧「开始」按钮上也绑长按的话，
 * 手指按住按钮稍久一点就会把待办删掉——那是最不该出现在计时类应用里的手滑。
 */
import { CheckIcon, iconStroke } from '../../lib/icons';
import { isTodoOverdue, todoTimeLabel } from '../../lib/todoTimeLabel';
import { useLongPress } from '../../hooks/useLongPress';
import type { Todo } from '../../types/domain';

interface TodoRowMobileProps {
  todo: Todo;
  now: number;
  onToggle: (done: boolean) => void;
  onStart: () => void;
  onDelete: () => void;
  /** 正在计时的就是这条待办对应的事项（后端按标题匹配） */
  active?: boolean;
}

export function TodoRowMobile({ todo, now, onToggle, onStart, onDelete, active = false }: TodoRowMobileProps) {
  const done = todo.doneAt != null;
  const overdue = isTodoOverdue(todo, now);
  const label = todoTimeLabel(todo, now);
  const longPress = useLongPress(() => {
    if (!done) onDelete();
  });

  return (
    <li className="m-todo" data-done={done ? 'true' : 'false'} data-overdue={overdue ? 'true' : 'false'}>
      <button
        type="button"
        className="m-todo__check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `把「${todo.title}」标记为未完成` : `完成「${todo.title}」`}
        onClick={() => onToggle(!done)}
      >
        {done && <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
      </button>

      <div className="m-todo__body" {...longPress} title="长按删除这条待办">
        <span className="m-todo__title">{todo.title}</span>
        <span className="m-todo__time" title={label.title ?? undefined}>
          {label.text}
          {active && <span className="m-badge m-badge--accent">计时中</span>}
        </span>
      </div>

      {!done && (
        <button type="button" className="m-btn m-btn--small m-btn--accent" onClick={onStart}>
          开始
        </button>
      )}
    </li>
  );
}
