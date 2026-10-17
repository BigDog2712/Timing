/**
 * TickBar — 「今日计时」记录行（todos-panel.md §1 行 + §3.1 四状态之「已完成 / 进行中」）
 * -----------------------------------------------------------------------------
 * 已完成：名 --ink-4 / 时刻 --ink-4 / 时长 --ink-2 + 删除线（--todo-name-done）
 * 进行中：--accent-wash 底 + 左 3px --accent 竖条 + 名 --ink·600 + 时长 --todo-time-current
 * 行可聚焦（键盘 ↑↓ 在行间移动）；右键 / Shift+F10 / Menu 键 → 事项菜单。
 * 事项改名 / 删除走内联条（mode=edit / confirm），不弹阻塞对话框。
 */
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { BellIcon } from '../../lib/icons';
import { formatClockTime, formatMinutes } from '../../lib/format';
import { InlineConfirmBar } from './InlineConfirmBar';
import { InlineEditBar } from './InlineEditBar';
import { TodoMark } from './TodoMark';

export type RowMode = 'view' | 'edit' | 'confirm';

interface TodosRecordRowProps {
  name: string;
  startedAt: number;
  seconds: number;
  status: 'done' | 'running';
  /** 事项已设提醒 → 名后 12px bell（--color-warn 可配提醒色） */
  remind?: boolean;
  mode: RowMode;
  onContextMenu: (e: ReactMouseEvent) => void;
  onSubmitRename: (name: string) => void;
  onCancelEdit: () => void;
  onConfirmDelete: () => void;
}

export function TodosRecordRow({
  name,
  startedAt,
  seconds,
  status,
  remind = false,
  mode,
  onContextMenu,
  onSubmitRename,
  onCancelEdit,
  onConfirmDelete,
}: TodosRecordRowProps) {
  const done = status === 'done';

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const fake = { clientX: rect.left + 12, clientY: rect.top + 8 } as ReactMouseEvent;
      onContextMenu(fake);
    }
  };

  if (mode === 'edit') {
    return (
      <div className="todo-row todo-row--editing" data-status={status}>
        <InlineEditBar value={name} ariaLabel="重命名事项" onSubmit={onSubmitRename} onCancel={onCancelEdit} />
      </div>
    );
  }

  if (mode === 'confirm') {
    return (
      <div className="todo-row todo-row--confirming" data-status={status}>
        <InlineConfirmBar
          text={`删除事项「${name}」？`}
          onConfirm={onConfirmDelete}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div
      className="todo-row"
      data-status={status}
      data-row
      tabIndex={0}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <TodoMark done={done} current={!done} />
      <span className="todo-row__name">
        <span className="todo-row__title" title={name}>
          {name}
        </span>
        {remind && <BellIcon size={12} strokeWidth={2.5} className="todo-row__bell" aria-label="已设提醒" />}
      </span>
      <time className="todo-row__time">{formatClockTime(startedAt)}</time>
      <span className="todo-row__dur">{formatMinutes(seconds)}</span>
    </div>
  );
}
