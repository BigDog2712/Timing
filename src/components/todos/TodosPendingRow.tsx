/**
 * TickBar — 待办行（todos-panel.md §1「待办事项」区 + §3.1 三级语气）
 * -----------------------------------------------------------------------------
 * 语气 data-tone：
 *   overdue → --todo-overdue（← --color-warn 可配提醒色）
 *   none    → --todo-no-time（--ink-4，两项时间都没设）
 *   normal  → --ink-2
 *   done    → 名 --todo-name-done + 删除线
 * 布局（V0.3.11）与「今日计时」行**同列**：名字 | 时间（居中的「开始时间」列）| 圆圈（贴右沿）。
 *   时间取值 = `remind_at ?? planned_at`（有开始时间按开始），两者皆无则留白。
 *   **[ADR-034] 文案按与今天的关系分级**（`逾期` / `MM-DD` / `HH:MM` / 跨年 `YY-MM-DD`），
 *   完整时间放 `title`；规则在 `lib/todoTimeLabel.ts`，本组件只负责渲染。
 * 交互（V0.3.11）：点整行 = 开关提醒（有则清空；没有就借用 `planned_at`；两个都没有就打开名字编辑？
 *   不 —— 见下），点圆圈 = 完成 / 未完成；圆圈颜色只表达「有没有提醒」。
 *
 * **[V0.3.13 / ADR-031] 编辑模式改成「就地打字」**（用户口径：点开编辑事项 = 进编辑模式，
 *   点名字直接删改、点时间直接输入，再点一次编辑事项退出）：
 *   - 点名字 → 原地变文本框（`InlineText`），Enter / 失焦提交，Esc 取消；
 *   - 点「开启 / 截止」→ 原地变文本框，输入 `09:00` / `明天 09:00` / `10-21 09:00` 均可；
 *   - 编辑模式下行点击不再切提醒（避免一边输入一边改状态），完成仍由圆圈负责。
 */
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import { iconStroke, TrashIcon } from '../../lib/icons';
import type { PickerAnchor } from '../../lib/pickerBox';
import type { TodoTimeField } from '../../lib/todoTimes';
import { isTodoOverdue, todoTimeLabel } from '../../lib/todoTimeLabel';
import type { Todo } from '../../types/domain';
import { DateTimePicker } from './DateTimePicker';
import { InlineText } from './InlineText';
import { TimeTextChip } from './TimeTextChip';

export type PendingTone = 'overdue' | 'none' | 'normal';

/**
 * 语气判定：已完成行不吃「已逾期」措辞（避免「已完成却逾期」的语义冲突）。
 * 逾期判据与时间列文案**共用** `lib/todoTimeLabel.isTodoOverdue` —— 两处各写一遍，
 * 迟早出现「格子写着逾期、行却不着色」（ADR-034）。
 */
export function pendingTone(todo: Todo, now: number): PendingTone {
  if (isTodoOverdue(todo, now)) return 'overdue';
  if (todo.plannedAt == null && todo.remindAt == null) return 'none';
  return 'normal';
}

type EditingCell = 'name' | 'remind' | 'planned' | null;

interface TodosPendingRowProps {
  todo: Todo;
  now: number;
  editMode: boolean;
  onToggle: (done: boolean) => void;
  onSubmitRename: (title: string) => void;
  /** AC-32：直接删除（无二次确认，由撤销条兜底） */
  onDelete: () => void;
  /** 改某一项时间；返回错误文案 = 被拒（截止早于开启），null = 已提交 */
  onChangeTime: (field: TodoTimeField, ms: number | null) => string | null;
  /** 时间被拒 / 名字不合规的提示转给面板错误行 */
  onEditError?: (message: string) => void;
}

export function TodosPendingRow({
  todo,
  now,
  editMode,
  onToggle,
  onSubmitRename,
  onDelete,
  onChangeTime,
  onEditError,
}: TodosPendingRowProps) {
  const done = todo.doneAt != null;
  const reminded = todo.remindAt != null;
  const tone = pendingTone(todo, now);
  const timeLabel = todoTimeLabel(todo, now);
  const rowRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<EditingCell>(null);
  /* 只读态「两个时间都没有」时点整行 → 当场选一个提醒时刻（此时没有可借用的时刻） */
  const [pickAnchor, setPickAnchor] = useState<PickerAnchor | null>(null);

  /** 行点击 = 是否提醒：编辑模式里不切状态，交给下方的名字 / 时间位 */
  const toggleRemind = () => {
    if (editMode || done) return;
    if (reminded) {
      onChangeTime('remind', null);
      return;
    }
    if (todo.plannedAt != null) {
      onChangeTime('remind', todo.plannedAt);
      return;
    }
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setPickAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right, width: rect.width });
  };

  const commitName = (text: string): boolean => {
    const title = text.trim();
    if (!title) {
      onEditError?.('待办标题不能为空');
      return false;
    }
    if (title === todo.title) {
      setEditing(null);
      return true;
    }
    onSubmitRename(title);
    setEditing(null);
    return true;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!e.repeat) onToggle(!done);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (editMode) setEditing('name');
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      toggleRemind();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onDelete();
    }
  };

  const nameCell =
    editMode && editing === 'name' ? (
      <InlineText
        className="todo-pend__title"
        value={todo.title}
        ariaLabel="待办标题"
        maxLength={TODO_TITLE_MAX_CHARS}
        onCommit={commitName}
        onCancel={() => setEditing(null)}
      />
    ) : editMode ? (
      <button
        type="button"
        className="todo-pend__title todo-pend__title--editable"
        title={`改名「${todo.title}」`}
        aria-label={`改名「${todo.title}」`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing('name');
        }}
      >
        {todo.title}
      </button>
    ) : (
      <span className="todo-pend__title" title={todo.title}>
        {todo.title}
      </span>
    );

  return (
    <div
      ref={rowRef}
      className="todo-pend"
      data-tone={tone}
      data-done={done ? 'true' : 'false'}
      data-edit={editMode ? 'true' : 'false'}
      data-row
      tabIndex={0}
      aria-label={`${todo.title}（${done ? '已完成' : '未完成'}）`}
      onClick={toggleRemind}
      onKeyDown={handleKeyDown}
    >
      {nameCell}

      {editMode ? (
        <span className="todo-pend__times">
          <TimeTextChip
            label="开启时间"
            value={todo.remindAt}
            now={now}
            allowEmpty
            className="todo-pend__chip"
            fieldAttr="remind"
            onCommit={(ms) => onChangeTime('remind', ms)}
            onError={onEditError}
          />
          <TimeTextChip
            label="截止时间"
            value={todo.plannedAt}
            now={now}
            allowEmpty
            className="todo-pend__chip"
            fieldAttr="planned"
            onCommit={(ms) => onChangeTime('planned', ms)}
            onError={onEditError}
          />
        </span>
      ) : (
        /* 只读：与「今日计时」同一套读数，落在「开始时间」列。
           [ADR-034] 未来写 `MM-DD`、逾期写「逾期」，完整时间（YYYY-MM-DD HH:MM）走 title。 */
        <time className="todo-pend__time" title={timeLabel.title ?? undefined}>
          {timeLabel.text}
        </time>
      )}

      <button
        type="button"
        className="todo-pend__mark"
        data-on={reminded ? 'true' : 'false'}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? '标记为未完成' : '标记为已完成'}
        title={done ? '标记为未完成' : '标记为已完成'}
        onClick={(e) => {
          /* 圆圈负责完成；提醒由整行承担 */
          e.stopPropagation();
          onToggle(!done);
        }}
      />

      {editMode && (
        <span className="todo-pend__actions">
          <button
            type="button"
            className="todo-pend__act todo-pend__act--danger"
            aria-label={`删除「${todo.title}」`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          </button>
        </span>
      )}

      {pickAnchor && (
        <DateTimePicker
          value={null}
          anchor={pickAnchor}
          anchorEl={rowRef.current}
          onChange={(ms) => {
            onChangeTime('remind', ms);
            setPickAnchor(null);
          }}
          onClose={() => setPickAnchor(null)}
        />
      )}
    </div>
  );
}
