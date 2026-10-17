/**
 * TickBar — 待办行（todos-panel.md §1「待办事项」区 + §3.1 三级语气）
 * -----------------------------------------------------------------------------
 * 语气 data-tone：
 *   overdue → --todo-overdue（← --color-warn 可配提醒色，文字「已逾期」）
 *   none    → --todo-no-time（--ink-4，文字「未设时间」）
 *   normal  → --ink-2（右对齐等宽计划时刻）
 *   done    → 名 --todo-name-done + 删除线
 * 交互：点圆标记勾选/取消完成；Space 同；Enter 改名；Delete 删除（AC-32：直接乐观删除 + 撤销条，无二次确认）。
 * 底栏「编辑事项」开启时（editMode）行尾显示 改名 / 删除 图标按钮。
 */
import type { KeyboardEvent } from 'react';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import { BellIcon, iconStroke, PencilIcon, TrashIcon } from '../../lib/icons';
import { formatClockTime } from '../../lib/format';
import type { Todo } from '../../types/domain';
import { InlineEditBar } from './InlineEditBar';
import { TodoMark } from './TodoMark';
import type { RowMode } from './TodosRecordRow';

export type PendingTone = 'overdue' | 'none' | 'normal';

/** 待办行模式：仅 查看 / 内联改名（删除不需二次确认态，见 AC-32） */
export type PendingRowMode = Extract<RowMode, 'view' | 'edit'>;

/** 语气判定：已完成行不吃「已逾期」措辞（避免「已完成却逾期」的语义冲突） */
export function pendingTone(todo: Todo, now: number): PendingTone {
  if (todo.plannedAt == null) return 'none';
  if (todo.doneAt == null && todo.plannedAt < now) return 'overdue';
  return 'normal';
}

function infoText(todo: Todo, tone: PendingTone): string {
  if (tone === 'none') return '未设时间';
  if (tone === 'overdue') return '已逾期';
  return formatClockTime(todo.plannedAt);
}

interface TodosPendingRowProps {
  todo: Todo;
  now: number;
  editMode: boolean;
  mode: PendingRowMode;
  onToggle: (done: boolean) => void;
  onSubmitRename: (title: string) => void;
  onCancelEdit: () => void;
  /** AC-32：直接删除（无二次确认，由撤销条兜底） */
  onDelete: () => void;
  onRequestEdit: () => void;
}

export function TodosPendingRow({
  todo,
  now,
  editMode,
  mode,
  onToggle,
  onSubmitRename,
  onCancelEdit,
  onDelete,
  onRequestEdit,
}: TodosPendingRowProps) {
  const done = todo.doneAt != null;
  const tone = pendingTone(todo, now);

  if (mode === 'edit') {
    return (
      <div className="todo-pend todo-pend--editing" data-tone={tone}>
        <InlineEditBar
          value={todo.title}
          ariaLabel="重命名待办"
          maxLength={TODO_TITLE_MAX_CHARS}
          onSubmit={onSubmitRename}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!e.repeat) onToggle(!done);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onRequestEdit();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onDelete();
    }
  };

  return (
    <div className="todo-pend" data-tone={tone} data-done={done ? 'true' : 'false'} data-row tabIndex={0} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="todo-pend__mark"
        role="checkbox"
        aria-checked={done}
        aria-label={`标记「${todo.title}」${done ? '未完成' : '已完成'}`}
        onClick={() => onToggle(!done)}
      >
        <TodoMark done={done} />
      </button>

      <span className="todo-pend__title" title={todo.title}>
        {todo.title}
        {todo.remindAt != null && (
          <BellIcon size={12} strokeWidth={2.5} className="todo-pend__bell" aria-label="已设提醒" />
        )}
      </span>

      <span className="todo-pend__info">{infoText(todo, tone)}</span>

      {editMode && (
        <span className="todo-pend__actions">
          <button type="button" className="todo-pend__act" aria-label={`重命名「${todo.title}」`} onClick={onRequestEdit}>
            <PencilIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          </button>
          <button
            type="button"
            className="todo-pend__act todo-pend__act--danger"
            aria-label={`删除「${todo.title}」`}
            onClick={onDelete}
          >
            <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}
