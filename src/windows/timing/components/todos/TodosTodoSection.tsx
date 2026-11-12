/**
 * Timing — 事项窗口「待办事项」区（todos-panel.md §1 分组 + §2 PendingSection）
 * -----------------------------------------------------------------------------
 * 分组：待办（未完成，三级语气）+ 已完成（名删除线）。分组用 1px --line 分隔，不用卡片。
 * Edge：未完成 > 8 条 → 折叠（--todos-pending-max），点「还有 N 条」展开。
 * 新增：[V0.3.9] 底栏「＋新增待办」改弹**表单卡**（`TodosComposeCard`，可填开启 / 截止时间）。
 * 删除：行尾 Trash / Delete 键 → 直接乐观删除（AC-32，撤销条兜底），无二次确认。
 * [V0.3.13] 编辑模式的行内状态（正在改名字 / 正在改时间）由行自己管，这里只透传开关，
 *           所以本组件不再需要 `editingId` 这类「选中行」状态。
 */
import { useState } from 'react';
import type { TodoTimeField } from '../../lib/todoTimes';
import type { Todo } from '../../types/domain';
import { TodosPendingRow } from './TodosPendingRow';

/** 折叠阈值（与 design-tokens --todos-pending-max 同值） */
const PENDING_VISIBLE = 8;

interface TodosTodoSectionProps {
  pending: Todo[];
  done: Todo[];
  now: number;
  editMode: boolean;
  onToggle: (id: number, done: boolean) => void;
  onSubmitRename: (id: number, title: string) => void;
  /** AC-32：直接删除（乐观删除 + 撤销条，无二次确认） */
  onDelete: (id: number) => void;
  /** 行内改某一项时间（开启 / 截止）；返回错误文案 = 被拒 */
  onChangeTime: (id: number, field: TodoTimeField, ms: number | null) => string | null;
  /** 名字不合规 / 时间被拒的提示转给面板错误行 */
  onEditError?: (message: string) => void;
}

export function TodosTodoSection(props: TodosTodoSectionProps) {
  const { pending, done, now, editMode, onToggle, onSubmitRename, onDelete, onChangeTime, onEditError } =
    props;

  const [expanded, setExpanded] = useState(false);
  const capped = pending.length > PENDING_VISIBLE;
  const visible = capped && !expanded ? pending.slice(0, PENDING_VISIBLE) : pending;

  return (
    <div className="todo-sec">
      <div className="todo-sec__head">
        <span className="todo-sec__label">待办事项 · {pending.length}</span>
      </div>

      {pending.length === 0 && <p className="todo-sec__none">没有待办，点底栏「＋新增待办」记一条</p>}

      {visible.map((todo) => (
        <TodosPendingRow
          key={todo.id}
          todo={todo}
          now={now}
          editMode={editMode}
          onToggle={(next) => onToggle(todo.id, next)}
          onSubmitRename={(title) => onSubmitRename(todo.id, title)}
          onDelete={() => onDelete(todo.id)}
          onChangeTime={(field, ms) => onChangeTime(todo.id, field, ms)}
          onEditError={onEditError}
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
          </div>
          {done.map((todo) => (
            <TodosPendingRow
              key={todo.id}
              todo={todo}
              now={now}
              editMode={editMode}
              onToggle={(next) => onToggle(todo.id, next)}
              onSubmitRename={(title) => onSubmitRename(todo.id, title)}
              onDelete={() => onDelete(todo.id)}
              onChangeTime={(field, ms) => onChangeTime(todo.id, field, ms)}
              onEditError={onEditError}
            />
          ))}
        </>
      )}
    </div>
  );
}
