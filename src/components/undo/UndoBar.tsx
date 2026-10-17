/**
 * TickBar — 撤销条 UndoBar（undo-bar.md，AC-05 / AC-06 / AC-07）
 * -----------------------------------------------------------------------------
 * 生命周期严格 = UNDO_WINDOW_MS 3000ms（uiStore.undoDeadline 由 domain 常量算出）。
 * 变体：默认（可撤销）/ 短时计时 < 60s（保存 / 丢弃两选）。
 * 撤销失败（TIMER_NO_UNDO / TIMER_ALREADY_RUNNING）由 useTimerActions 友好提示，
 * 本组件只负责按窗口退场，绝不因失败而崩溃。
 */
import { useEffect, useState } from 'react';
import { SHORT_RECORD_SEC } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { UndoIcon, iconStroke } from '../../lib/icons';
import { ipc } from '../../services/ipc';
import { useTimerActions } from '../../hooks/useTimerActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';

export function UndoBar() {
  const record = useUiStore((s) => s.undoRecord);
  const deadline = useUiStore((s) => s.undoDeadline);
  const clearUndo = useUiStore((s) => s.clearUndo);
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!record || deadline == null) return;
    const remain = Math.max(0, deadline - Date.now());
    const id = window.setTimeout(() => clearUndo(), remain);
    return () => window.clearTimeout(id);
  }, [record, deadline, clearUndo]);

  if (!record) return null;

  const isShort = record.accumulatedSec < SHORT_RECORD_SEC;
  const name = itemName(items, record.itemId);

  const handleUndo = async () => {
    setBusy(true);
    try {
      await actions.undo(record.id);
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    try {
      await ipc.deleteRecord({ id: record.id });
    } finally {
      clearUndo();
      setBusy(false);
    }
  };

  return (
    <div className="undo" role="status" data-short={isShort ? 'true' : 'false'}>
      {isShort ? (
        <>
          <span className="undo__text">只记了 {record.accumulatedSec} 秒，要留下吗？</span>
          <div className="undo__actions">
            <button type="button" className="undo__btn undo__btn--primary" onClick={clearUndo} disabled={busy}>
              保存
            </button>
            <button type="button" className="undo__btn" onClick={() => void handleDiscard()} disabled={busy}>
              丢弃
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="undo__text">
            已记录 <span className="undo__time">{formatDuration(record.accumulatedSec)}</span> · {name}
          </span>
          <button
            type="button"
            className="undo__btn undo__btn--primary"
            onClick={() => void handleUndo()}
            disabled={busy}
          >
            <UndoIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            撤销
          </button>
        </>
      )}
    </div>
  );
}
