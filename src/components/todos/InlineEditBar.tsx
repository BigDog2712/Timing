/**
 * TickBar — 内联编辑条 InlineEditBar（事项窗：待办改名 / 事项改名共用）
 * -----------------------------------------------------------------------------
 * 输入 + 保存 / 取消；Enter 提交、Esc 取消、自动聚焦。空值不允许提交。
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { iconStroke, XIcon } from '../../lib/icons';

interface InlineEditBarProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  /** 输入上限（HTML maxLength）；待办标题传 TODO_TITLE_MAX_CHARS，避免超长提交撞后端误导性报错 */
  maxLength?: number;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}

export function InlineEditBar({ value, placeholder, ariaLabel, maxLength, onSubmit, onCancel }: InlineEditBarProps) {
  const [draft, setDraft] = useState(value);
  const trimmed = draft.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <span className="inline-edit">
      <input
        className="inline-edit__input"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button type="button" className="inline-edit__ok" disabled={!trimmed} onClick={submit}>
        保存
      </button>
      <button type="button" className="inline-edit__cancel" aria-label="取消编辑" onClick={onCancel}>
        <XIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
      </button>
    </span>
  );
}
