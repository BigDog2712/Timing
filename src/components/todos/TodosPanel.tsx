/**
 * TickBar — 事项窗口主面板 TodosPanel（todos-panel.md）
 * -----------------------------------------------------------------------------
 * 结构：表头汇总（今日计时 · N 条 / 共 X 小时 Y 分）+「今日计时」记录区
 *       （已完成 / 进行中）+「待办事项」区（待办三级语气 + 已完成）+ 40 底栏 + 空态。
 * 数据：今日记录 = stats_summary + list_records（今日区间）；进行中 = timerStore 会话（本地 tick）；
 *       待办 = todoStore（includeDone）。事项名 = itemStore。
 * 交互：事项行右键 → 事项菜单（停止计时 / 编辑事项 / 删除事项）；改名与删除走内联条。
 *       待办删除 = 乐观删除 + 3s 撤销条（AC-32，TodoUndoBar），无二次确认弹窗。
 * 5 态：Loading（骨架）/ Error（重试）/ Empty（图标空态）/ Populated / Edge（待办 >8 折叠）。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useRowFocusNav } from '../../hooks/useRowFocusNav';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useTodayRecords } from '../../hooks/useTodayRecords';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { errorText, ipc } from '../../services/ipc';
import { openNoteForItem } from '../../services/noteActions';
import { todosActions } from '../../services/todosActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { splitTodos, useTodoStore } from '../../stores/todoStore';
import { TodoUndoBar } from './TodoUndoBar';
import { TodosEmpty } from './TodosEmpty';
import { TodosFooter } from './TodosFooter';
import { TodosHeader } from './TodosHeader';
import { TodosItemMenu } from './TodosItemMenu';
import { TodosRecordRow, type RowMode } from './TodosRecordRow';
import { TodosTodoSection } from './TodosTodoSection';

interface TodosPanelProps {
  onRequestClose?: () => void;
}

/** 事项改名 / 删除绑定的**具体行**（同一事项可能有多条今日记录，避免整列弹条） */
interface ItemAction {
  key: string;
  itemId: number;
  mode: Exclude<RowMode, 'view'>;
}

interface ItemMenuState {
  x: number;
  y: number;
  itemId: number;
  key: string;
}

const SKELETON_ROWS = [0, 1, 2];

export function TodosPanel({ onRequestClose }: TodosPanelProps) {
  const todos = useTodoStore((s) => s.todos);
  const todosLoading = useTodoStore((s) => s.loading);
  const todosLoaded = useTodoStore((s) => s.loaded);
  const todosError = useTodoStore((s) => s.error);
  const items = useItemStore((s) => s.items);
  const session = useTimerStore((s) => s.state.session);
  const liveSec = useTimerTick();
  const today = useTodayRecords();
  const rowNav = useRowFocusNav();
  const timerActions = useTimerActions();

  const [editMode, setEditMode] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [itemAction, setItemAction] = useState<ItemAction | null>(null);
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /* 延迟提交失败的提示（AC-32：删除未落库 → 已回滚本地行） */
  const commitError = useTodoStore((s) => s.commitError);

  /* 逾期判定基准（每分钟刷新；不依赖高频 tick） */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* 首帧待办（含已完成） */
  useEffect(() => {
    void useTodoStore.getState().reload().catch(() => undefined);
  }, []);

  /* 延迟提交失败提示 4s 自动消失（复用 NoticeBar 的节奏） */
  useEffect(() => {
    if (!commitError) return;
    const id = window.setTimeout(() => useTodoStore.getState().clearCommitError(), 4000);
    return () => window.clearTimeout(id);
  }, [commitError]);

  const { pending, done } = useMemo(() => splitTodos(todos), [todos]);

  const run = async (fn: () => Promise<unknown>, onDone?: () => void) => {
    setActionError(null);
    try {
      await fn();
      onDone?.();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onRequestClose?.();
      return;
    }
    rowNav(e);
  };

  const openItemMenu = (e: ReactMouseEvent, itemId: number, key: string) => {
    e.preventDefault();
    setItemMenu({ x: e.clientX, y: e.clientY, itemId, key });
  };

  const loading = today.loading || (todosLoading && !todosLoaded);
  const error = today.error ?? todosError;
  const recordCount = today.rows.length + (session ? 1 : 0);
  const totalSec = today.totalSec + (session ? liveSec : 0);
  const isEmpty = today.rows.length === 0 && !session && todos.length === 0;

  const modeOfKey = (key: string): RowMode => (itemAction?.key === key ? itemAction.mode : 'view');
  const clearItemAction = () => setItemAction(null);
  const renameRowItem = (itemId: number, name: string) => void run(() => renameItem(itemId, name), clearItemAction);
  const deleteRowItem = (itemId: number) => void run(() => deleteItem(itemId, today.reload), clearItemAction);

  const runningKey = session ? `live-${session.id}` : '';

  return (
    <div className="todos" role="dialog" aria-label="今日计时" tabIndex={-1} onKeyDown={handleKeyDown}>
      <TodosHeader recordCount={recordCount} totalSec={totalSec} />

      <div className="todos__body">
        {loading && (
          <div className="todos__skel" aria-hidden>
            {SKELETON_ROWS.map((row) => (
              <span key={row} className="todos__skel-row" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="todos__state" role="alert">
            <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={today.reload}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && isEmpty && <TodosEmpty onAdd={() => setComposing(true)} />}

        {!loading && !error && !isEmpty && (
          <>
            {recordCount > 0 && (
              <div className="todos__records">
                {session && (
                  <TodosRecordRow
                    name={itemName(items, session.itemId)}
                    startedAt={session.startedAt}
                    seconds={liveSec}
                    status="running"
                    mode={modeOfKey(runningKey)}
                    onContextMenu={(e) => openItemMenu(e, session.itemId, runningKey)}
                    onSubmitRename={(name) => renameRowItem(session.itemId, name)}
                    onCancelEdit={clearItemAction}
                    onConfirmDelete={() => deleteRowItem(session.itemId)}
                  />
                )}
                {today.rows.map((row) => {
                  const key = `rec-${row.id}`;
                  return (
                    <TodosRecordRow
                      key={key}
                      name={itemName(items, row.itemId)}
                      startedAt={row.startedAt}
                      seconds={row.accumulatedSec}
                      status="done"
                      mode={modeOfKey(key)}
                      onContextMenu={(e) => openItemMenu(e, row.itemId, key)}
                      onSubmitRename={(name) => renameRowItem(row.itemId, name)}
                      onCancelEdit={clearItemAction}
                      onConfirmDelete={() => deleteRowItem(row.itemId)}
                    />
                  );
                })}
              </div>
            )}

            <TodosTodoSection
              pending={pending}
              done={done}
              now={now}
              editMode={editMode}
              editingId={editingId}
              composing={composing}
              onToggle={(id, next) => void run(() => todosActions.toggle(id, next))}
              onStartEdit={(id) => setEditingId(id)}
              onCancelEdit={() => setEditingId(null)}
              onSubmitRename={(id, title) => void run(() => todosActions.rename(id, title), () => setEditingId(null))}
              onDelete={(id) => todosActions.remove(id)}
              onSubmitCompose={(title) => void run(() => todosActions.create(title), () => setComposing(false))}
              onCancelCompose={() => setComposing(false)}
            />
          </>
        )}
      </div>

      {(actionError ?? commitError) && (
        <p className="todos__err" role="alert">
          {actionError ?? commitError}
        </p>
      )}

      <TodoUndoBar />

      <TodosFooter onAdd={() => setComposing(true)} onToggleEdit={() => setEditMode((v) => !v)} editMode={editMode} />

      {itemMenu && (
        <TodosItemMenu
          anchor={{ x: itemMenu.x, y: itemMenu.y }}
          itemId={itemMenu.itemId}
          itemName={itemName(items, itemMenu.itemId)}
          isActive={session?.itemId === itemMenu.itemId}
          onClose={() => setItemMenu(null)}
          onStop={() => void run(() => timerActions.stop())}
          onEdit={() => setItemAction({ key: itemMenu.key, itemId: itemMenu.itemId, mode: 'edit' })}
          onDelete={() => setItemAction({ key: itemMenu.key, itemId: itemMenu.itemId, mode: 'confirm' })}
          onNote={() => void openNoteForItem(itemMenu.itemId)}
        />
      )}
    </div>
  );
}

/* ------------------------------ 事项操作 ------------------------------ */

async function renameItem(itemId: number, name: string): Promise<void> {
  await ipc.updateItem({ id: itemId, patch: { name } });
  await useItemStore.getState().reload();
}

async function deleteItem(itemId: number, reloadRecords: () => void): Promise<void> {
  await ipc.deleteItem({ id: itemId });
  await useItemStore.getState().reload();
  reloadRecords();
}
