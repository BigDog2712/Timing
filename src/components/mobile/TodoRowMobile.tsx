/**
 * Timing — 移动端待办行
 * -----------------------------------------------------------------------------
 * 一行承担四个动作（PRD P0-6 / §4 ②）：
 *   点圆圈 = 完成 / 取消完成；点「开始」= 变成计时（空闲走 `todo_start`，
 *   已经在计时则先问「结束并新开 / 仅改归属」，见 `SwitchModeSheet`）；
 *   **长按整行 = 删除**（乐观删除 + 3s 撤销条，与桌面 AC-32 同口径，不弹二次确认）。
 *
 * 「开始」是否出现由 `onStart` 是否传入决定，两种「不该有开始」的情况：
 *   - 已完成：后端 `todo_start` 对 `done_at` 非空的待办一律回 TODO_NOT_FOUND
 *     （`services/todo_start.rs` 的守卫），渲染出来就是个点了必报错的死按钮；
 *     要计这件事应该先点圆圈取消完成，或直接新建一条。
 *   - 正在计时：切给自己没有意义，点了只会收到 TIMER_ALREADY_RUNNING；
 *     改为同一位置的静态标记（不可点），视觉槽位不变，用户不用重新找。
 *     文案区分「计时中 / 已暂停」：手机端的恢复入口只在计时页，光看「计时中」
 *     分不出秒表还在不在走。
 *
 * 长按只绑在文字区（不是整行）：右侧操作区上也绑长按的话，
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
  /**
   * 这条待办**能不能**开始计时。`undefined` = 该行没有「开始」这个动作
   * （已完成区就不传：后端 `todo_start` 对 `done_at` 非空的待办一律回 TODO_NOT_FOUND，
   * 渲染一个点了必报错的按钮比不渲染更糟）。
   */
  onStart?: () => void;
  onDelete: () => void;
  /** 正在计时的就是这条待办对应的事项（后端按标题匹配） */
  active?: boolean;
  /**
   * 当前会话已暂停（仅 `active` 时有意义）。
   * 手机端的「继续」入口只在计时页，文案不区分「计时中 / 已暂停」的话，
   * 用户会以为秒表还在走（P2-5）。
   */
  paused?: boolean;
}

export function TodoRowMobile({
  todo,
  now,
  onToggle,
  onStart,
  onDelete,
  active = false,
  paused = false,
}: TodoRowMobileProps) {
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
        </span>
      </div>

      {!done &&
        (active ? (
          /* `role="status"`：这块只在 idle ⇄ running ⇄ paused 之间出现/换字，
             作为 live region 播报正合适（P2-8） */
          <span className="m-badge m-badge--accent m-todo__live" role="status">
            {paused ? '已暂停' : '计时中'}
          </span>
        ) : (
          onStart != null && (
            <button type="button" className="m-btn m-btn--small m-btn--accent" onClick={onStart}>
              开始
            </button>
          )
        ))}
    </li>
  );
}
