/**
 * TickBar — 崩溃恢复对话框 RecoverDialog（recover-dialog.md，AC-14）
 * -----------------------------------------------------------------------------
 * 启动检测到 active 会话时弹出，三选一：继续计时(resume) / 结束并保存(close) / 丢弃(discard)。
 * 焦点默认落在最保守的「继续计时」；Esc 等价「继续计时」（不丢弃数据）；点遮罩不关闭。
 * 遮罩用 --scrim 纯色半透明（禁 backdrop-filter）。
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { formatClockTime, formatDuration } from '../../lib/format';
import { CheckIcon, ClockIcon, PlayIcon, TrashIcon, iconStroke } from '../../lib/icons';
import { useTimerActions } from '../../hooks/useTimerActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import type { TimeRecord } from '../../types/domain';

interface RecoverDialogProps {
  session: TimeRecord;
}

export function RecoverDialog({ session }: RecoverDialogProps) {
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    buttonsRef.current[0]?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void actions.resolveRecover('resume');
      return;
    }
    if (e.key === 'Tab') {
      // 焦点陷阱：在 3 个按钮间循环，不逃逸到药丸
      const count = buttonsRef.current.length;
      const current = buttonsRef.current.findIndex((el) => el === document.activeElement);
      e.preventDefault();
      const delta = e.shiftKey ? -1 : 1;
      const next = (current + delta + count) % count;
      buttonsRef.current[next]?.focus();
    }
  };

  const name = itemName(items, session.itemId);

  return (
    <div className="dialog-scrim">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recover-title"
        onKeyDown={handleKeyDown}
      >
        <h2 className="dialog__title" id="recover-title">
          上次计时没有正常结束
        </h2>
        <p className="dialog__summary">
          <ClockIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>
            {name} · 已计时 <span className="undo__time">{formatDuration(session.accumulatedSec)}</span>
          </span>
        </p>
        <p className="dialog__meta">开始于 {formatClockTime(session.startedAt)}，意外退出</p>

        <div className="dialog__buttons">
          <button
            type="button"
            className="btn btn--primary"
            ref={(el) => {
              buttonsRef.current[0] = el;
            }}
            onClick={() => void actions.resolveRecover('resume')}
          >
            <PlayIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            继续计时
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            ref={(el) => {
              buttonsRef.current[1] = el;
            }}
            onClick={() => void actions.resolveRecover('close')}
          >
            <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            结束并保存
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            ref={(el) => {
              buttonsRef.current[2] = el;
            }}
            onClick={() => void actions.resolveRecover('discard')}
          >
            <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            丢弃
          </button>
        </div>
      </div>
    </div>
  );
}
