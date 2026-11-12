/**
 * Timing — 「今日计时」记录行（todos-panel.md §1 行 + §3.1 四状态之「已完成 / 进行中」）
 * -----------------------------------------------------------------------------
 * 已完成：名 --ink-4 / 时刻 --ink-4 / 时长 --ink-2 + 删除线（--todo-name-done）
 * 进行中：--accent-wash 底 + 左 3px --accent 竖条 + 名 --ink·600 + 时长 --todo-time-current
 * 行可聚焦（键盘 ↑↓ 在行间移动）；右键 / Shift+F10 / Menu 键 → 事项菜单。
 * 无状态圆：左端不画 TodoMark；状态由时长色 + 删除线 + 进行中行左侧竖条表达。
 * 事项删除走内联确认条（mode=confirm），不弹阻塞对话框。
 *
 * **[V0.3.13 / ADR-031] 编辑模式 = 就地打字**（用户口径「点开编辑事项…点名字删改、点时间输入」）：
 *   - 点名字 → 原地文本框（`InlineText`），Enter / 失焦提交；
 *   - 点开始 / 结束 → 原地文本框（`TimeTextChip` + `lib/timeInput`），不再弹日历浮层；
 *   - 行尾删除 → 内联确认条（记录挂的是**事项**，删的是事项本身，保留二次确认）。
 */
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { BellIcon, iconStroke, TrashIcon } from '../../lib/icons';
import { formatClockTime, formatMinutes } from '../../lib/format';
import { InlineConfirmBar } from './InlineConfirmBar';
import { InlineText } from './InlineText';
import { TimeTextChip } from './TimeTextChip';

/** 行状态：查看 / 删除确认（改名已改为就地编辑，不再占一个模式） */
export type RowMode = 'view' | 'confirm';

type EditingCell = 'name' | 'start' | 'end' | null;

interface TodosRecordRowProps {
  name: string;
  startedAt: number;
  /** 结束时间（同日已保存记录才有；进行中为 null）→ 时间列显示「开始–结束」 */
  endedAt?: number | null;
  seconds: number;
  /** 同名合并后的记录条数（仅用于分组数据，界面不再显示计数后缀） */
  count?: number;
  status: 'done' | 'running';
  /** 事项已设提醒 → 名后 12px bell（--color-warn 可配提醒色） */
  remind?: boolean;
  mode: RowMode;
  /** 底栏「编辑事项」是否打开 —— 打开后名字可点、时间可打字、行尾出现删除 */
  editMode: boolean;
  /** 展示的这个区间对应的两条边界记录（编辑起止时刻时改的就是它们） */
  startRecordId?: number;
  endRecordId?: number;
  /** 提交新的开始 / 结束时刻（走 `update_record`，由父组件落库） */
  onCommitTime: (recordId: number, field: 'start' | 'end', ms: number) => void;
  /** 落库失败 / 被拒的提示转给上层错误行 */
  onTimeError?: (message: string) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  /** 请求删除确认（内联条） */
  onRequestDelete: () => void;
  /** [V0.3.9] 悬停该行 → 在窗口左侧预览该事项的便利贴（无便利贴则不弹） */
  onHoverStart?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onHoverEnd?: () => void;
  onSubmitRename: (name: string) => void;
  onCancelEdit: () => void;
  onConfirmDelete: () => void;
  /** 当前时刻（时间位跨天时预填日期） */
  now: number;
  /**
   * [V0.4.2] 点整行 = 开始这一条事项的计时（用户口径「在事项菜单点击事项可以直接开始计时」）。
   * 不传 = 本行不可点（进行中那行本来就是当前会话，点了也没意义）。
   */
  onActivate?: () => void;
}

export function TodosRecordRow({
  name,
  startedAt,
  endedAt = null,
  seconds,
  status,
  remind = false,
  mode,
  editMode,
  startRecordId,
  endRecordId,
  onCommitTime,
  onTimeError,
  onContextMenu,
  onRequestDelete,
  onHoverStart,
  onHoverEnd,
  onSubmitRename,
  onCancelEdit,
  onConfirmDelete,
  now,
  onActivate,
}: TodosRecordRowProps) {
  const done = status === 'done';
  const [editing, setEditing] = useState<EditingCell>(null);
  /* [P2] 对齐 Timing v1.7.3 今日计时面板的「起点 / 止点」两列：
     有结束时间就给区间（同一天内只显示时刻），否则退化为单个开始时刻。 */
  const timeText =
    endedAt != null && done
      ? `${formatClockTime(startedAt)}–${formatClockTime(endedAt)}`
      : formatClockTime(startedAt);

  const commitName = (text: string): boolean => {
    const next = text.trim();
    if (!next) {
      onTimeError?.('事项名不能为空');
      return false;
    }
    if (next !== name) onSubmitRename(next);
    setEditing(null);
    return true;
  };

  const commitTime = (field: 'start' | 'end', ms: number): string | null => {
    if (field === 'start' && endedAt != null && ms > endedAt) return '开始时间不能晚于结束时间';
    if (field === 'end' && ms < startedAt) return '结束时间不能早于开始时间';
    const target = field === 'start' ? startRecordId : (endRecordId ?? startRecordId);
    if (target == null) return '这条记录无法编辑时刻';
    onCommitTime(target, field, ms);
    return null;
  };

  /* 可点 = 有回调、且不在编辑模式（编辑模式的点击属于改名 / 输时间，不该顺手起计时） */
  const clickable = onActivate != null && !editMode;

  /** 行内命中按钮 / 输入框时不算「点这一行」 */
  const activate = (target: EventTarget | null) => {
    if (!clickable) return;
    const el = target as HTMLElement | null;
    if (el?.closest?.('button, input, textarea, [contenteditable="true"]')) return;
    onActivate?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const fake = { clientX: rect.left + 12, clientY: rect.top + 8 } as ReactMouseEvent;
      onContextMenu(fake);
      return;
    }
    /* 非编辑态：Enter 就等同于点这一行（键盘可达，todos-panel.md 的行导航约定） */
    if (!editMode && clickable && e.key === 'Enter') {
      e.preventDefault();
      onActivate?.();
      return;
    }
    if (!editMode) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditing('name');
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onRequestDelete();
    }
  };

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

  const nameCell =
    editMode && editing === 'name' ? (
      <InlineText
        className="todo-row__title"
        value={name}
        ariaLabel="事项名称"
        maxLength={60}
        onCommit={commitName}
        onCancel={() => setEditing(null)}
      />
    ) : editMode ? (
      <button
        type="button"
        className="todo-row__name todo-row__name--btn"
        title={`改名「${name}」`}
        aria-label={`改名「${name}」`}
        onClick={() => setEditing('name')}
      >
        <span className="todo-row__title">{name}</span>
        {remind && <BellIcon size={12} strokeWidth={2.5} className="todo-row__bell" aria-label="已设提醒" />}
      </button>
    ) : (
      <span className="todo-row__name">
        <span className="todo-row__title" title={name}>
          {name}
        </span>
        {remind && <BellIcon size={12} strokeWidth={2.5} className="todo-row__bell" aria-label="已设提醒" />}
      </span>
    );

  return (
    <div
      className="todo-row"
      data-status={status}
      data-edit={editMode ? 'true' : 'false'}
      data-row
      data-clickable={clickable ? 'true' : 'false'}
      tabIndex={0}
      onClick={(e) => activate(e.target)}
      onContextMenu={onContextMenu}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onKeyDown={handleKeyDown}
    >
      {nameCell}

      {/* [V0.3.13] 编辑态：起止时刻各自就地打字（只有已保存的记录才有可改的边界） */}
      {editMode && done && startRecordId != null ? (
        <span className="todo-row__times">
          <TimeTextChip
            label="开始时刻"
            value={startedAt}
            now={now}
            allowEmpty={false}
            className="todo-row__chip"
            fieldAttr="start"
            onCommit={(ms) => (ms == null ? '开始时刻不能为空' : commitTime('start', ms))}
            onError={onTimeError}
          />
          <TimeTextChip
            label="结束时刻"
            value={endedAt}
            now={now}
            allowEmpty={false}
            className="todo-row__chip"
            fieldAttr="end"
            onCommit={(ms) => (ms == null ? '结束时刻不能为空' : commitTime('end', ms))}
            onError={onTimeError}
          />
        </span>
      ) : (
        <time className="todo-row__time">{timeText}</time>
      )}
      <span className="todo-row__dur">{formatMinutes(seconds)}</span>
      {editMode && (
        <span className="todo-row__actions">
          <button
            type="button"
            className="todo-row__act"
            aria-label={`删除事项「${name}」`}
            onClick={onRequestDelete}
          >
            <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}
