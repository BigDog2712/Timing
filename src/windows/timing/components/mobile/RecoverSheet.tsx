/**
 * Timing — 崩溃 / 杀进程恢复 Sheet（冷启动 session 非空时必弹）
 * -----------------------------------------------------------------------------
 * 三选一：继续（resume）/ 结束并保存（close）/ 丢弃（discard）。
 * 与桌面 `RecoverDialog` 同一套判据（`lib/recoverGap`：只有当时在跑、且空档 ≥1 分钟
 * 才值得让用户决定要不要把「退出期间」并进累计）。默认 false = R-2「应用关着就停表」。
 *
 * 手机上的差别只有两点：
 *   1. 用底部 Sheet 而不是居中对话框，并且**不可下滑关闭**——必须做个决定；
 *   2. 文案里的「退出期间」改成「中间的空白」，并对秒数做 `formatMinutes` 读数
 *      （手机上没人去数 00:07:31）。
 */
import { useState } from 'react';
import { formatClockTime, formatDuration, formatMinutes } from '../../lib/format';
import { ClockIcon, iconStroke } from '../../lib/icons';
import { recoverGapSec, shouldAskGap } from '../../lib/recoverGap';
import { useTimerActions } from '../../hooks/useTimerActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import type { TimeRecord } from '../../types/domain';
import { Sheet } from './Sheet';

interface RecoverSheetProps {
  session: TimeRecord;
}

export function RecoverSheet({ session }: RecoverSheetProps) {
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const [includeGap, setIncludeGap] = useState(false);
  const [busy, setBusy] = useState(false);

  const gapSec = recoverGapSec(session, Date.now());
  const askGap = shouldAskGap(gapSec);
  const name = itemName(items, session.itemId);
  const totalSec = session.accumulatedSec + (includeGap ? gapSec : 0);

  const resolve = async (action: 'resume' | 'close' | 'discard') => {
    setBusy(true);
    try {
      await actions.resolveRecover(action, includeGap);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="上次计时没有正常结束"
      role="alertdialog"
      dismissible={false}
      onClose={() => undefined}
      footer={
        <div className="m-stack">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--wide"
            disabled={busy}
            onClick={() => void resolve('resume')}
          >
            继续计时
          </button>
          <button
            type="button"
            className="m-btn m-btn--wide"
            disabled={busy}
            onClick={() => void resolve('close')}
          >
            结束并保存
          </button>
          <button
            type="button"
            className="m-btn m-btn--danger m-btn--wide"
            disabled={busy}
            onClick={() => void resolve('discard')}
          >
            丢弃这一段
          </button>
        </div>
      }
    >
      <p className="m-recover__line">
        <ClockIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        <span>
          {name} · 已计时 <strong>{formatDuration(totalSec)}</strong>
        </span>
      </p>
      <p className="m-hint">开始于 {formatClockTime(session.startedAt)}，应用在计时中退出了。</p>

      {askGap && (
        <label className="m-check">
          <input type="checkbox" checked={includeGap} onChange={(e) => setIncludeGap(e.target.checked)} />
          <span>
            把中间的空白也算进去（{formatMinutes(gapSec)}）
            {includeGap && <span className="m-check__sub">→ 合计 {formatDuration(totalSec)}</span>}
          </span>
        </label>
      )}

      <p className="m-hint">选「继续」不会把退出的那段时间计入，秒表从落盘值接着走。</p>
    </Sheet>
  );
}
