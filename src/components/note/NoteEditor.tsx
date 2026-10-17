/**
 * TickBar — 便利贴正文编辑区 NoteEditor（sticky-note.md §1 / §3.3 / §3.5）
 * -----------------------------------------------------------------------------
 * - 无边框可编辑区（--note-body-bg + radius-sm 8 + padding 9 11）；6px 自绘滚动条走 CSS。
 * - 纯文本、保留换行（sticky-note.md：「换行折叠为空格」由记录行侧处理）。
 * - 键盘：`Esc` 失焦（不关窗）；`Ctrl+Enter` 保存并失焦（§3.5）。
 * - [V0.2.2 · 2] 轻量 markdown 列表：行首 `-` 按空格变成 `• `；`Enter` 续行带缩进与
 *   圆点；`Tab` / `Shift+Tab` 对选中行做 2 空格缩进 / 反缩进（Tab 不再跳焦点）。
 *   文本变换都在 `lib/noteText.ts` 的纯函数里，组件只负责取选区与落光标。
 * - 文字浓淡由 --ui-text-opacity 控制（设置面板可调），未悬停时正文仍可获焦可输入。
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import {
  bulletizeOnSpace,
  continueListOnEnter,
  indentSelection,
} from '../../lib/noteText';
import type { EditResult } from '../../lib/noteText';

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 保存并失焦（Ctrl+Enter / 失焦） */
  onCommit: () => void;
  /** 首帧自动聚焦（新建便利贴直接开写） */
  autoFocus?: boolean;
  /** 无障碍标签（V0.2.1：界面上已无标题文字，语义只能挂在这里） */
  ariaLabel?: string;
}

export function NoteEditor({ value, onChange, onCommit, autoFocus = false, ariaLabel = '便利贴正文' }: NoteEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  /* 受控组件：文本经 React 提交后再落选区，避免 setSelectionRange 读到旧值 */
  useEffect(() => {
    const node = ref.current;
    const selection = selectionRef.current;
    if (!node || !selection) return;
    selectionRef.current = null;
    node.setSelectionRange(selection.start, selection.end);
  }, [value]);

  /** 把纯函数算出的编辑结果写回受控组件，并记下待落的光标位置 */
  const apply = (edit: EditResult | null): boolean => {
    if (!edit) return false;
    selectionRef.current = { start: edit.start, end: edit.end };
    onChange(edit.value);
    return true;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const node = e.currentTarget;
    const selection = { start: node.selectionStart, end: node.selectionEnd };

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCommit();
      node.blur();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      node.blur();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      apply(indentSelection(value, selection, e.shiftKey));
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (apply(continueListOnEnter(value, selection))) e.preventDefault();
      return;
    }

    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (apply(bulletizeOnSpace(value, selection))) e.preventDefault();
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
        aria-label={ariaLabel}
      />
    </div>
  );
}
