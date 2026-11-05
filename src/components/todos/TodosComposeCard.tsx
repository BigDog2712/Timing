/**
 * Timing — 事项窗「新增待办」卡（V0.3.9）
 * -----------------------------------------------------------------------------
 * 用户口径：新增待办要与「新增常用摸鱼 / 常用事项」一样**弹一张表单**（不再在列表首行
 * 就地塞一个输入框），并且可以选填**开启时间**与**截止时间**，也可以都不填。
 *
 * 字段 → 数据：
 *   - 截止时间 → `planned_at`（逾期判定用它，`TodosPendingRow.pendingTone`）
 *   - 开启时间 → `remind_at`（到点提醒时刻，行上显示小铃铛）
 *   两者都留空 = 未排期、无提醒（现状）。
 * 时间输入用自绘的 `DateTimeField`：原生 `datetime-local` 既加不了「x 天后」提示，
 * 也没法把小时切成上午 / 下午（中文环境固定 24 小时制）。
 * 纯表单组件：取值 / 校验 / 落库都在 `TodosPanel`，这里只负责渲染与键盘路径
 * （Enter 提交、Esc 取消——窗级 keydown 已放行输入框内的事件）。
 */
import { useState } from 'react';
import { TODO_TITLE_MAX_CHARS } from '../../lib/constants';
import { iconStroke, XIcon } from '../../lib/icons';
import { DateTimeField } from './DateTimeField';

interface TodosComposeCardProps {
  busy: boolean;
  onSubmit: (title: string, plannedAt: number | null, remindAt: number | null) => void;
  onCancel: () => void;
}

export function TodosComposeCard({ busy, onSubmit, onCancel }: TodosComposeCardProps) {
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState<number | null>(null);
  const [dueAt, setDueAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();

  const submit = () => {
    if (!trimmed || busy) return;
    if (dueAt != null && startAt != null && dueAt < startAt) {
      setError('截止时间不能早于开启时间');
      return;
    }
    setError(null);
    onSubmit(trimmed, dueAt, startAt);
  };

  return (
    <div
      className="todos-compose"
      role="dialog"
      aria-label="新增待办"
      /* Esc 在整张卡里都等于取消：窗级 keydown 不再收输入框里的事件，这里自己兜 */
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="todos-compose__head">
        <span className="todos-compose__title">新增待办</span>
        <button type="button" className="todos-compose__close" aria-label="取消新增待办" onClick={onCancel}>
          <XIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      </div>

      <input
        type="text"
        className="todos-compose__input"
        placeholder="待办名称"
        aria-label="待办名称"
        maxLength={TODO_TITLE_MAX_CHARS}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />

      <DateTimeField label="开启时间" value={startAt} onChange={setStartAt} />
      <DateTimeField label="截止时间" value={dueAt} onChange={setDueAt} />

      {error && (
        <p className="todos-compose__err" role="alert">
          {error}
        </p>
      )}

      <div className="todos-compose__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || trimmed.length === 0}
          onClick={submit}
        >
          添加
        </button>
      </div>
    </div>
  );
}
