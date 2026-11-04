/**
 * TickBar — 3 秒撤销条（计时结束 / 待办删除共用一条）
 * -----------------------------------------------------------------------------
 * 为什么合并：手机上底部只有一条位置，两套 3s 条会在「刚结束计时又删了一条待办」时叠在一起。
 * 计时撤销优先（它是用户刚做完的主动作）。
 *
 * `StopResult.discarded = true`（短于最短记录时长）时后端已软删，`useTimerActions.stop`
 * 根本不会写 `uiStore.undoRecord` —— 所以这里天然不会出现「撤销一条不该存在的记录」。
 * 待办删除是乐观删除（`todoStore.pendingDelete`），它的 3s 计时器在 store 里，
 * 到期自动落库，本组件只负责显示与撤销。
 */
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { formatDuration } from '../../lib/format';
import { UndoIcon, iconStroke } from '../../lib/icons';
import { useTimerActions } from '../../hooks/useTimerActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useTodoStore } from '../../stores/todoStore';
import { useUiStore } from '../../stores/uiStore';

export function UndoToast() {
  const record = useUiStore((s) => s.undoRecord);
  const deadline = useUiStore((s) => s.undoDeadline);
  const clearUndo = useUiStore((s) => s.clearUndo);
  const pendingTodo = useTodoStore((s) => s.pendingDelete);
  const undoRemove = useTodoStore((s) => s.undoRemove);
  const items = useItemStore((s) => s.items);
  const actions = useTimerActions();

  /* 计时撤销的 3s 窗口由 uiStore 的 deadline 表达（桌面 UndoBar 同源），这里只补退场 */
  useEffect(() => {
    if (!record || deadline == null) return;
    const remain = Math.max(0, deadline - Date.now());
    const id = window.setTimeout(() => clearUndo(), remain);
    return () => window.clearTimeout(id);
  }, [record, deadline, clearUndo]);

  const timerRemain = deadline == null ? 0 : Math.max(0, deadline - Date.now());
  const todoRemain = pendingTodo == null ? 0 : Math.max(0, pendingTodo.deadline - Date.now());
  const remain = record ? timerRemain : todoRemain;

  if (!record && !pendingTodo) return null;

  /* 进度条按剩余时间线性收缩：用行内 animation-duration 起点即「剩下的毫秒数」 */
  const barStyle: CSSProperties = { animationDuration: `${Math.max(remain, 0)}ms` };

  return (
    <div className="m-undo" role="status">
      <span className="m-undo__text">
        {record ? (
          <>
            已记录 <strong>{formatDuration(record.accumulatedSec)}</strong> · {itemName(items, record.itemId)}
          </>
        ) : (
          <>已删除「{pendingTodo?.todo.title}」</>
        )}
      </span>
      <button
        type="button"
        className="m-btn m-btn--accent"
        onClick={() => {
          if (record) {
            /* 撤销 = 这条记录被删掉、会话回到运行中。记录页与今日汇总都按「已保存的记录」
               算数，不在这里发一次刷新信号的话，用户会看到总计条数纹丝不动。 */
            void actions.undo(record.id).then(() => useMobileUiStore.getState().bumpRecords());
          } else {
            undoRemove();
          }
        }}
      >
        <UndoIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        撤销
      </button>
      <span className="m-undo__bar" style={barStyle} aria-hidden />
    </div>
  );
}
