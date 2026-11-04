/**
 * TickBar — 小条内联命名 InlineNameEntry（[V0.2.3 · 3]）
 * -----------------------------------------------------------------------------
 * 左键点事项名 / 点「新建事项」→ 直接在条上长出输入框，Enter 落地，Esc 放弃。
 * 零面板：不再弹 ItemPicker（完整表单仍留在右键菜单「新建事项…」里）。
 * 指针事件不冒泡到 .pill：否则在输入框里拖选文字会被当成「拖动整条窗口」（PillBar 自绘拖动）。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';

interface InlineNameEntryProps {
  /** 进入时的文本（重命名用；新建为空） */
  initial?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** 事项名长度上限（与 ItemPicker 的 maxLength / 后端 `ITEM_NAME_MAX_LEN` 同值） */
const NAME_MAX_LENGTH = ITEM_NAME_MAX_CHARS;

export function InlineNameEntry({ initial = '', placeholder = '新事项名称', onSubmit, onCancel }: InlineNameEntryProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  /* 提交/取消后不要再被 blur 触发第二次回调 */
  const settledRef = useRef(false);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    if (initial) node.select();
  }, [initial]);

  const settle = (fn: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    fn();
  };

  const submit = () => {
    const text = value.trim();
    if (!text) {
      settle(onCancel);
      return;
    }
    settle(() => onSubmit(text));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      settle(onCancel);
    }
  };

  /* 指针不进 .pill：拖选文字不该拖动窗口，点击输入框也不该被当成条上的手势 */
  const stopPointer = (e: ReactPointerEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <input
      ref={inputRef}
      className="pill__input"
      type="text"
      value={value}
      maxLength={NAME_MAX_LENGTH}
      placeholder={placeholder}
      aria-label={placeholder}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onBlur={() => settle(onCancel)}
    />
  );
}
