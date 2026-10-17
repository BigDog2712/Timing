/**
 * TickBar — 事项窗口「待办事项」区（todos-panel.md §1 分组 + §2 PendingSection）
 * -----------------------------------------------------------------------------
 * 分组：待办（未完成，三级语气）+ 已完成（名删除线）。分组用 1px --line 分隔，不用卡片。
 * Edge：未完成 > 8 条 → 折叠（--todos-pending-max），点「还有 N 条」展开。
 * 新增：footer「＋新增待办」→ 列表首行内联输入（composing）。
 * 删除：行尾 Trash / Delete 键 → 直接乐观删除（AC-32，撤销条兜底），无二次确认。
 */
import { useState } from 'react';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import type { Todo } from '../../types/domain';
import { InlineEditBar } from './InlineEditBar';
import { TodosPendingRow, type PendingRowMode } from './TodosPendingRow';

/** 折叠阈值（与 design-tokens --todos-pending-max 同值） */
const PENDING_VISIBLE = 8;

interface TodosTodoSectionProps {
  pending: Todo[];
  done: Todo[];
  now: number;
  editMode: boolean;
  editingId: number | null;
  composing: boolean;
  onToggle: (id: number, done: boolean) => void;
  onStartEdit: (id: number) => void;
  onCancelEdit: () => void;
  onSubmitRename: (id: number, title: string) => void;
  /** AC-32：直接删除（乐观删除 + 撤销条，无二次确认） */
  onDelete: (id: number) => void;
  onSubmitCompose: (title: string) => void;
  onCancelCompose: () => void;
}

export function TodosTodoSection(props: TodosTodoSectionProps) {
  const {
    pending,
    done,
    now,
    editMode,
    editingId,
    composing,
    onToggle,
    onStartEdit,
    onCancelEdit,
    onSubmitRename,
    onDelete,
    onSubmitCompose,
    onCancelCompose,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const capped = pending.length > PENDING_VISIBLE;
  const visible = capped && !expanded ? pending.slice(0, PENDING_VISIBLE) : pending;

  const modeOf = (id: number): PendingRowMode => (editingId === id ? 'edit' : 'view');

  return (
    <div className="todo-sec">
      <div className="todo-sec__head">
        <span className="todo-sec__label">待办事项 · {pending.length}</span>
        <span className="todo-sec__meta">预计执行</span>
      </div>

      {composing && (
        <div className="todo-pend todo-pend--editing">
          <InlineEditBar
            value=""
            placeholder="新待办的名称"
            ariaLabel="新待办名称"
            maxLength={TODO_TITLE_MAX_CHARS}
            onSubmit={onSubmitCompose}
            onCancel={onCancelCompose}
          />
        </div>
      )}

      {pending.length === 0 && !composing && <p className="todo-sec__none">没有待办，点底栏「＋新增待办」记一条</p>}

      {visible.map((todo) => (
        <TodosPendingRow
          key={todo.id}
          todo={todo}
          now={now}
          editMode={editMode}
          mode={modeOf(todo.id)}
          onToggle={(next) => onToggle(todo.id, next)}
          onRequestEdit={() => onStartEdit(todo.id)}
          onCancelEdit={onCancelEdit}
          onSubmitRename={(title) => onSubmitRename(todo.id, title)}
          onDelete={() => onDelete(todo.id)}
        />
      ))}

      {capped && !expanded && (
        <button type="button" className="todo-sec__more" onClick={() => setExpanded(true)}>
          还有 {pending.length - PENDING_VISIBLE} 条
        </button>
      )}

      {done.length > 0 && (
        <>
          <div className="todo-sec__head todo-sec__head--done">
            <span className="todo-sec__label">已完成 · {done.length}</span>
            <span className="todo-sec__meta">计划</span>
          </div>
          {done.map((todo) => (
            <TodosPendingRow
              key={todo.id}
              todo={todo}
              now={now}
              editMode={editMode}
              mode={modeOf(todo.id)}
              onToggle={(next) => onToggle(todo.id, next)}
              onRequestEdit={() => onStartEdit(todo.id)}
              onCancelEdit={onCancelEdit}
              onSubmitRename={(title) => onSubmitRename(todo.id, title)}
              onDelete={() => onDelete(todo.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}
