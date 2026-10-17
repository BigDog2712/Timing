/**
 * TickBar — 待办撤销条 TodoUndoBar（AC-32 / undo-bar.md 视觉规格复用）
 * -----------------------------------------------------------------------------
 * 触发：事项窗内删除一条待办（乐观删除）→ 底部浮出「已删除『XXX』· 撤销」。
 * 复用 V0.1.0 撤销条的 `.undo` 视觉类（同底 / 同描边 / 同圆角 / 同入场动效），
 * 语义与 `.undo` 的 timer 变体**隔离**（本组件只服务待办，不改动 timer 撤销语义）。
 * 生命周期 = todoStore.pendingDelete（撤销窗由 store 的 3s 计时器负责提交与退场）。
 * 无障碍：role="status" 宣告；「撤销」为原生 button（Tab/Enter 可触发）；挂载即聚焦撤销，
 * 保证「删除行卸载后焦点不丢」。
 */
import { useEffect, useRef } from 'react';
import { UndoIcon, iconStroke } from '../../lib/icons';
import { useTodoStore } from '../../stores/todoStore';

export function TodoUndoBar() {
  const pending = useTodoStore((s) => s.pendingDelete);
  const undoRemove = useTodoStore((s) => s.undoRemove);
  const undoRef = useRef<HTMLButtonElement>(null);

  /* 行已从 DOM 移除 → 把焦点交给「撤销」，键盘用户可即刻 Enter 撤回 */
  useEffect(() => {
    if (pending) undoRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  /* 撤销后本组件卸载 → 把焦点交回面板容器（避免焦点丢到 body） */
  const handleUndo = () => {
    undoRemove();
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.todos')?.focus();
    });
  };

  return (
    <div className="todos__undo">
      <div className="undo" role="status">
        <span className="undo__text" title={pending.todo.title}>
          已删除「{pending.todo.title}」
        </span>
        <button
          ref={undoRef}
          type="button"
          className="undo__btn undo__btn--primary"
          onClick={handleUndo}
        >
          <UndoIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          撤销
        </button>
      </div>
    </div>
  );
}
