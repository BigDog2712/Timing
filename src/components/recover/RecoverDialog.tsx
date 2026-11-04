/**
 * Timing — 崩溃恢复对话框 RecoverDialog（recover-dialog.md，AC-14）
 * -----------------------------------------------------------------------------
 * 启动检测到 active 会话时弹出，三选一：继续计时(resume) / 结束并保存(close) / 丢弃(discard)。
 * 焦点默认落在最保守的「继续计时」；Esc 等价「继续计时」（不丢弃数据）；点遮罩不关闭。
 * 遮罩用 --scrim 纯色半透明（禁 backdrop-filter）。
 *
 * **[V0.4.2] 「退出期间」可选并入**（用户口径：被强制退出的事项，可选择退出期间是否并入计时）：
 * 默认口径仍是 R-2「应用关着就停表」，勾上才把「最后一次落盘 → 现在」那段空档补进累计。
 * 勾选项只在**当时正在跑**、且空档 ≥ 1 分钟时出现——暂停中崩溃没有流逝可补，
 * 几十秒的空档也不值得让用户做一次决定（后端同样会忽略这种补偿，见 `timer::gap_sec`）。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatClockTime, formatDuration } from '../../lib/format';
import { recoverGapSec, shouldAskGap } from '../../lib/recoverGap';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [includeGap, setIncludeGap] = useState(false);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  /* 判定口径在 lib/recoverGap（与后端 timer::gap_sec 同一条规则，单测钉住） */
  const gapSec = recoverGapSec(session, Date.now());
  const askGap = shouldAskGap(gapSec);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void actions.resolveRecover('resume', includeGap);
      return;
    }
    if (e.key === 'Tab') {
      /* 焦点陷阱：对话框内的复选框与 3 个按钮之间循环，不逃逸到药丸。
         走 querySelectorAll 而不是手写 ref 数组——勾选项按条件渲染，ref 会漏。 */
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button, input[type="checkbox"]');
      const list = nodes ? Array.from(nodes) : [];
      if (list.length === 0) return;
      e.preventDefault();
      const current = list.indexOf(document.activeElement as HTMLElement);
      const delta = e.shiftKey ? -1 : 1;
      const next = current < 0 ? 0 : (current + delta + list.length) % list.length;
      list[next]?.focus();
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
        ref={dialogRef}
        onKeyDown={handleKeyDown}
      >
        <h2 className="dialog__title" id="recover-title">
          上次计时没有正常结束
        </h2>
        <p className="dialog__summary">
          <ClockIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>
            {name} · 已计时 <span className="undo__time">{formatDuration(session.accumulatedSec)}</span>
            {includeGap && (
              <span className="dialog__plus"> → {formatDuration(session.accumulatedSec + gapSec)}</span>
            )}
          </span>
        </p>
        <p className="dialog__meta">开始于 {formatClockTime(session.startedAt)}，意外退出</p>

        {askGap && (
          <label className="dialog__check">
            <input
              type="checkbox"
              checked={includeGap}
              onChange={(e) => setIncludeGap(e.target.checked)}
            />
            <span>把退出期间（{formatDuration(gapSec)}）也计入</span>
          </label>
        )}

        <div className="dialog__buttons">
          <button
            type="button"
            className="btn btn--primary"
            ref={primaryRef}
            onClick={() => void actions.resolveRecover('resume', includeGap)}
          >
            <PlayIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            继续计时
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void actions.resolveRecover('close', includeGap)}
          >
            <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            结束并保存
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--danger"
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
