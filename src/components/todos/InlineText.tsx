/**
 * TickBar — 就地文本编辑（V0.3.13 / ADR-031）
 * -----------------------------------------------------------------------------
 * 用户口径：「点开编辑事项后…点击一个事项名，随后可以删除、写下其他名字」——名字不是弹一条
 * 带「确定 / 取消」的编辑条，而是**原地变成可输入的文本框**：
 *   - 自动聚焦并全选（点一下就能直接改写）；
 *   - `Enter` 提交、`Esc` 取消、**失焦也算提交**（点别处就走，不用找按钮）；
 *   - 提交被拒（`onCommit` 返回 false，比如空名字 / 时间格式不对）时**保持编辑态**并标红，
 *     不把用户打的字吞掉；
 *   - 键位全部 `stopPropagation`：行上的 Space / Enter / R / Delete 不能被打字抢走，
 *     面板的 Esc 关窗也不能把「取消这一处编辑」升级成「关掉整个窗口」。
 */
import { useEffect, useRef, useState } from 'react';

interface InlineTextProps {
  /** 初始文本（进入编辑时的那一份） */
  value: string;
  ariaLabel: string;
  /** 追加类名（行内名字 / 时间位各用各的观感） */
  className?: string;
  maxLength?: number;
  /**
   * 提交。返回 false = 被拒：保持编辑态并标红（提示文案由调用方写到 `onError` 或行内 title）。
   */
  onCommit: (text: string) => boolean;
  onCancel: () => void;
}

export function InlineText({ value, ariaLabel, className, maxLength, onCommit, onCancel }: InlineTextProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  /** 已经提交 / 取消过：防止 `Enter` 之后紧跟的 blur 二次提交 */
  const settled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    if (onCommit(draft)) settled.current = true;
    else {
      setInvalid(true);
      ref.current?.select();
    }
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      className={className ? `inline-text ${className}` : 'inline-text'}
      data-invalid={invalid ? 'true' : undefined}
      value={draft}
      maxLength={maxLength}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      title={invalid ? '内容不合规，修改后按 Enter' : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        /* 已经因为「提交被拒」红过一次的，再失焦就当作放弃，别卡在编辑态 */
        if (invalid) cancel();
        else commit();
      }}
    />
  );
}
