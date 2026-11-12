/**
 * Timing — 崩溃恢复对话框 RecoverDialog（批 2 · V0.11.24，PRD §13.5）
 * -----------------------------------------------------------------------------
 * 启动检测到 active 会话时弹出，**三个元素**（净变化 4 → 3）：
 *   A 主按钮 `一直算到现在（HH:MM:SS）` = 空档并入累计并继续计时（resume + includeGap）；
 *   B 次按钮 `结束在 HH:MM（HH:MM:SS）` = **按关闭时间结束**（close + endAt = 关闭时间）；
 *   C 文字级次要动作 `丢弃这段` = 软删除（discard）。
 * 复选框已删除：它的全部含义被 A / B 吸收（勾上 = A，不勾 = B）。
 *
 * 「关闭时间」= `running_since`（最后一次落盘锚点，误差 ≤30s，界面只称「关闭」）。
 * 选项 B 的结束时刻取关闭时间、**不是 now**——这是本轮唯一的行为变化点（PRD §13.5.2）。
 *
 * 暂停中崩溃（`runningSince == null`）：单按钮分支 `结束并保存（…）`，
 * 元信息 `已暂停`，**不编造关闭时刻**（H-C7/H-C8）。
 *
 * 焦点默认落主按钮；**Esc = 次按钮**（`结束在 …`）——空档无法被证明是工作，
 * 虚增十几小时事后极难纠正，少算时长只需重开一次；点遮罩仍不关闭（§13.5.4-③⑤）。
 * 遮罩用 --scrim 纯色半透明（禁 backdrop-filter）。
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { formatClockTime, formatDuration } from '../../lib/format';
import { recoverGapSec } from '../../lib/recoverGap';
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

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  /* 关闭时间 = 最后一次落盘锚点；暂停中为 null → 走单按钮分支，不显示关闭时刻。 */
  const closeAt = session.runningSince;
  const paused = closeAt == null;
  /* 选项 A 的读数：累计 + 空档（空档判据与后端 timer::gap_sec 同一条规则，单测钉住）。 */
  const resumeSec = session.accumulatedSec + recoverGapSec(session, Date.now());

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      /* Esc = 次按钮（H6）：按关闭时间结束；暂停分支只有一个按钮，同样执行它。
         【变异点 ②】若这里改回 resolveRecover('resume', true)（旧「Esc = 继续计时」），
         RecoverDialog 的 H6 用例必须红。 */
      void actions.resolveRecover('close', false, paused ? undefined : closeAt);
      return;
    }
    if (e.key === 'Tab') {
      /* 焦点陷阱：只在对话框的按钮间循环，不逃逸到药丸。 */
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button');
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
          </span>
        </p>
        {paused ? (
          /* H-C8：暂停后没有流逝，不编造关闭时刻 */
          <p className="dialog__meta">{formatClockTime(session.startedAt)} 开始，已暂停</p>
        ) : (
          /* H-C3：两个时刻都是 HH:MM 24 小时制；跨零点不显示日期 */
          <p className="dialog__meta">
            {formatClockTime(session.startedAt)} 开始，{formatClockTime(closeAt)} 关闭
          </p>
        )}

        {paused ? (
          <div className="dialog__buttons">
            <button
              type="button"
              className="btn btn--primary"
              ref={primaryRef}
              onClick={() => void actions.resolveRecover('close')}
            >
              <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              结束并保存（{formatDuration(session.accumulatedSec)}）
            </button>
          </div>
        ) : (
          <div className="dialog__buttons">
            <button
              type="button"
              className="btn btn--primary"
              ref={primaryRef}
              onClick={() => void actions.resolveRecover('resume', true)}
            >
              <PlayIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              一直算到现在（{formatDuration(resumeSec)}）
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void actions.resolveRecover('close', false, closeAt)}
            >
              <CheckIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              结束在 {formatClockTime(closeAt)}（{formatDuration(session.accumulatedSec)}）
            </button>
          </div>
        )}
        <div className="dialog__buttons">
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            onClick={() => void actions.resolveRecover('discard')}
          >
            <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            丢弃这段
          </button>
        </div>
      </div>
    </div>
  );
}
