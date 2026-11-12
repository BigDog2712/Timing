/**
 * Timing — 撤销条 UndoBar（undo-bar.md，AC-05 / AC-06 / AC-07）
 * -----------------------------------------------------------------------------
 * 生命周期严格 = UNDO_WINDOW_MS 3000ms（uiStore.undoDeadline 由 domain 常量算出）。
 *
 * 形态只有一个：`已记录 <时长> · <事项名>` + 「撤销」。
 * [V0.3.4] 删除「短记录二选一（保存 / 丢弃）」分支（ADR-023）：短到不值得留的会话
 * 已在后端按「最短记录时长」直接忽略（`StopResult.discarded`，前端根本拿不到撤销条），
 * 留下来的记录有 3 秒撤销兜底——再问一次「要留下吗」纯属多一次点击。
 *
 * 撤销失败（TIMER_NO_UNDO / TIMER_ALREADY_RUNNING）由 useTimerActions 友好提示，
 * 本组件只负责按窗口退场，绝不因失败而崩溃。
 */
import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/format';
import { UndoIcon, iconStroke } from '../../lib/icons';
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

  const name = itemName(items, record.itemId);

  const handleUndo = async () => {
    setBusy(true);
    try {
      await actions.undo(record.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="undo" role="status">
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
    </div>
  );
}
