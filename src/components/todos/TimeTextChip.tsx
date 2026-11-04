/**
 * Timing — 行内时间位（V0.3.13 / ADR-031，取代 V0.3.10 的日历浮层）
 * -----------------------------------------------------------------------------
 * 用户口径：「点击某一事项的开始时间，输入新的时间即可」。于是时间位就是一枚**可点的文本**：
 *   - 只读：等宽 `HH:MM`（未设时是淡淡的「+」）；
 *   - 点开：同一格变成文本框，预填可读回来的 `HH:MM` / `MM-DD HH:MM`，`Enter` / 失焦提交；
 *   - 解析交给 `lib/timeInput`（支持 `09:00` / `明天 09:00` / `10-21 09:00`）；
 *   - 业务校验交给调用方：`onCommit` 返回错误文案就**保持编辑态**并把文案交给 `onError`
 *     显示在面板的错误行上（截止早于开启、结束早于开始这类）。
 *
 * 待办行与计时行共用本组件，差别只在类名（`.todo-pend__chip` / `.todo-row__chip`）与
 * 「允不允许清空」（待办可空置、记录不可）。
 */
import { useState } from 'react';
import { formatClockTime } from '../../lib/format';
import { parseTimeInput, timeInputText } from '../../lib/timeInput';
import { InlineText } from './InlineText';

interface TimeTextChipProps {
  /** 「开启时间」/「截止时间」/「开始时刻」…（无障碍标签与标题） */
  label: string;
  /** 当前值（epoch ms）；null = 未设 */
  value: number | null;
  /** 今天 / 当前时刻（跨天时输入框里预填日期） */
  now: number;
  /** 允许清空（待办可以空置；计时记录必须有值） */
  allowEmpty: boolean;
  className: string;
  /** `data-field` 标记（测试与样式钩子） */
  fieldAttr: string;
  /** 提交；返回错误文案 = 被拒（保持编辑态），返回 null = 成功 */
  onCommit: (ms: number | null) => string | null;
  /** 被拒的原因转给面板错误行（可选） */
  onError?: (message: string) => void;
}

export function TimeTextChip({
  label,
  value,
  now,
  allowEmpty,
  className,
  fieldAttr,
  onCommit,
  onError,
}: TimeTextChipProps) {
  const [editing, setEditing] = useState(false);

  const commit = (text: string): boolean => {
    const raw = text.trim();
    if (!raw) {
      if (!allowEmpty) {
        onError?.(`${label}不能为空`);
        return false;
      }
      const error = onCommit(null);
      if (error) {
        onError?.(error);
        return false;
      }
      setEditing(false);
      return true;
    }
    const parsed = parseTimeInput(raw, now);
    if (!parsed.ok) {
      onError?.(parsed.error);
      return false;
    }
    const error = onCommit(parsed.ms);
    if (error) {
      onError?.(error);
      return false;
    }
    setEditing(false);
    return true;
  };

  if (editing) {
    return (
      <InlineText
        className={`${className} inline-text--time`}
        value={value == null ? '' : timeInputText(value, now)}
        ariaLabel={label}
        maxLength={20}
        onCommit={commit}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const hasValue = value != null;
  return (
    <button
      type="button"
      className={className}
      data-field={fieldAttr}
      data-empty={hasValue ? undefined : 'true'}
      title={hasValue ? `${label}：点击输入新的时间` : `${label}未设，点击填写`}
      aria-label={hasValue ? `${label} ${formatClockTime(value)}，点击修改` : `${label}未设，点击填写`}
      onClick={(e) => {
        /* 只开编辑，不触发行的「开关提醒 / 完成」 */
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {hasValue ? formatClockTime(value) : '+'}
    </button>
  );
}
