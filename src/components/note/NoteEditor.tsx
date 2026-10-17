/**
 * TickBar — 便利贴正文编辑区 NoteEditor（sticky-note.md §1 / §3.3 / §3.5）
 * -----------------------------------------------------------------------------
 * - 无边框可编辑区（--note-body-bg + radius-sm 8 + padding 9 11）；6px 自绘滚动条走 CSS。
 * - 纯文本、保留换行（sticky-note.md：「换行折叠为空格」由记录行侧处理）。
 * - focus = 1px --accent-line + 3px --accent-wash 外发光（CSS）。
 * - 键盘：`Esc` 失焦（不关窗）；`Ctrl+Enter` 保存并失焦（§3.5）。
 * - 未悬停时正文**仍可获焦可输入**（pointer-events 始终 auto，只在 CSS 里保持 opacity 1）。
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 保存并失焦（Ctrl+Enter / 失焦） */
  onCommit: () => void;
  /** 首帧自动聚焦（新建便利贴直接开写） */
  autoFocus?: boolean;
}

export function NoteEditor({ value, onChange, onCommit, autoFocus = false }: NoteEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCommit();
      ref.current?.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ref.current?.blur();
    }
  };

  return (
    <div className="note__body">
      <textarea
        ref={ref}
        className="note__input"
        value={value}
        spellCheck={false}
        placeholder="写点什么…"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        aria-label="便利贴正文"
      />
    </div>
  );
}
