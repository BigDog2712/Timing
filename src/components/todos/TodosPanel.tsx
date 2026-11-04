/**
 * TickBar — 事项窗口主面板 TodosPanel（todos-panel.md）
 * -----------------------------------------------------------------------------
 * 结构：表头汇总（今日计时 · N 条 / 共 X 小时 Y 分）+「今日计时」记录区
 *       （已完成 / 进行中）+「待办事项」区（待办三级语气 + 已完成）+ 40 底栏 + 空态。
 * 数据：今日记录 = stats_summary + list_records（今日区间）；进行中 = timerStore 会话（本地 tick）；
 *       待办 = todoStore（includeDone），范围切分见 `lib/todoPanelLists.ts`（ADR-034 全部未完成）。
 * 交互：事项行右键 → 事项菜单（停止计时 / 编辑事项 / 删除事项）；删除走内联确认条。
 *       [V0.3.13] 编辑事项 = 打开编辑模式后就地打字：点名字改名字、点时间输入时间，
 *       再点一次底栏「编辑事项」退出（见 InlineText / TimeTextChip）。
 *       待办删除 = 乐观删除 + 3s 撤销条（AC-32，TodoUndoBar），无二次确认弹窗。
 * 5 态：Loading（骨架）/ Error（重试）/ Empty（图标空态）/ Populated / Edge（待办 >8 折叠）。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useNotePreview } from '../../hooks/useNotePreview';
import { useRowFocusNav } from '../../hooks/useRowFocusNav';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useTodayRecords } from '../../hooks/useTodayRecords';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { groupTodayRecords } from '../../lib/todayGroups';
import { todoPanelLists } from '../../lib/todoPanelLists';
import { todoTimePatch, type TodoTimeField } from '../../lib/todoTimes';
import { errorText } from '../../services/ipc';
import { deleteItem, renameItem } from '../../services/itemRowActions';
import { openNoteForItem, openNoteWindowFor } from '../../services/noteActions';
import { todosActions } from '../../services/todosActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { NotePreview } from './NotePreview';
import { TodoUndoBar } from './TodoUndoBar';
import { TodosComposeCard } from './TodosComposeCard';
import { TodosEmpty } from './TodosEmpty';
import { TodosFooter } from './TodosFooter';
import { TodosHeader } from './TodosHeader';
import { TodosItemMenu } from './TodosItemMenu';
import { TodosRecords } from './TodosRecords';
import { TodosTodoSection } from './TodosTodoSection';
import type { RowMode } from './TodosRecordRow';

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
  const [composeBusy, setComposeBusy] = useState(false);
  const [itemAction, setItemAction] = useState<ItemAction | null>(null);
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /* 延迟提交失败的提示（AC-32：删除未落库 → 已回滚本地行） */
  const commitError = useTodoStore((s) => s.commitError);

  /* [V0.3.9] 悬停记录行 → 左侧透明区预览该事项的便利贴（状态在 hook 里） */
  const notePreview = useNotePreview();

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

  /* [ADR-034] 待办区 = 全部未完成（含未来 / 逾期 / 未排期）+ 今天完成的已完成；
     取代 ADR-032 的「只显示今天」（未来待办曾因此整条不可见）。取舍写在 lib/todoPanelLists.ts。 */
  const { pending, done } = useMemo(() => todoPanelLists(todos, now), [todos, now]);

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
    /* 窗里的按键先归输入框自己（新增待办 / 改名）：Escape 在输入框里是「取消这条编辑」，
       冒泡上来会被当成「关窗」；↑↓ 也会被行导航抢走焦点。这里直接放行，避免打字打到一半
       输入框消失、甚至整窗关掉。 */
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
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
  /* [P2] 同名合并 + 按开始时间升序（见 lib/todayGroups.ts）：一行 = 一个事项名，
     行内给开始–结束区间与合并后时长；进行中的会话仍单独占一行（它有实时秒数）。 */
  const groups = useMemo(
    () => groupTodayRecords(today.rows, (itemId) => itemName(items, itemId)),
    [today.rows, items],
  );
  const recordCount = groups.length + (session ? 1 : 0);
  const totalSec = today.totalSec + (session ? liveSec : 0);
  const isEmpty = today.rows.length === 0 && !session && pending.length === 0 && done.length === 0;

  /** [V0.4.2] 点记录行 = 开始这一条事项的计时。口径在 `useTimerActions.startOrSwitch`，
   *  这里只把可能开着的行内状态（删除确认 / 右键菜单）收掉。 */
  const startFromRow = (itemId: number) => {
    setItemAction(null);
    setItemMenu(null);
    void timerActions.startOrSwitch(itemId);
  };

  const modeOfKey = (key: string): RowMode => (itemAction?.key === key ? itemAction.mode : 'view');
  const clearItemAction = () => setItemAction(null);
  const renameRowItem = (itemId: number, name: string) => void run(() => renameItem(itemId, name), clearItemAction);
  const deleteRowItem = (itemId: number) => void run(() => deleteItem(itemId, today.reload), clearItemAction);

  /* [V0.3.13] 待办行内改时间：校验（截止 ≥ 开启）在纯函数里，返回错误文案给行内的输入框；
     通过则立刻落库（异步失败仍走面板错误行）。 */
  const changeTodoTime = (id: number, field: TodoTimeField, ms: number | null): string | null => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return '待办不存在';
    const result = todoTimePatch(todo, field, ms);
    if (!result.ok) return result.error;
    void run(() => todosActions.patch(id, result.patch));
    return null;
  };

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
              <TodosRecords
                session={session}
                groups={groups}
                liveSec={liveSec}
                itemNameOf={(id) => itemName(items, id)}
                modeOfKey={modeOfKey}
                editMode={editMode}
                onReloadToday={today.reload}
                now={now}
                onRequestDelete={(key, itemId) => setItemAction({ key, itemId, mode: 'confirm' })}
                onContextMenu={openItemMenu}
                onHoverStart={notePreview.hoverStart}
                onHoverEnd={notePreview.hoverEnd}
                onSubmitRename={renameRowItem}
                onCancelEdit={clearItemAction}
                onConfirmDelete={deleteRowItem}
                onActivate={startFromRow}
              />
            )}

            <TodosTodoSection
              pending={pending}
              done={done}
              now={now}
              editMode={editMode}
              onToggle={(id, next) => void run(() => todosActions.toggle(id, next))}
              onSubmitRename={(id, title) => void run(() => todosActions.rename(id, title))}
              onDelete={(id) => todosActions.remove(id)}
              onChangeTime={changeTodoTime}
              onEditError={setActionError}
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

      {/* [V0.3.9] 新增待办改成表单卡（名称 + 可选的开启 / 截止时间），贴在底栏上方 */}
      {composing && (
        <TodosComposeCard
          busy={composeBusy}
          onSubmit={(title, plannedAt, remindAt) => {
            setComposeBusy(true);
            void run(
              () => todosActions.create(title, plannedAt, remindAt),
              () => setComposing(false),
            ).finally(() => setComposeBusy(false));
          }}
          onCancel={() => setComposing(false)}
        />
      )}

      {itemMenu && (
        <TodosItemMenu
          anchor={{ x: itemMenu.x, y: itemMenu.y }}
          itemId={itemMenu.itemId}
          itemName={itemName(items, itemMenu.itemId)}
          isActive={session?.itemId === itemMenu.itemId}
          onClose={() => setItemMenu(null)}
          onStop={() => void run(() => timerActions.stop())}
          onStart={() => {
            setItemMenu(null);
            void timerActions.startOrSwitch(itemMenu.itemId);
          }}
          onEdit={() => setEditMode(true)}
          onDelete={() => setItemAction({ key: itemMenu.key, itemId: itemMenu.itemId, mode: 'confirm' })}
          onNote={() => void openNoteForItem(itemMenu.itemId)}
        />
      )}

      {/* 便利贴预览画在窗口左侧透明区（`.todos` 有 overflow:hidden + backdrop-filter，
          卡片必须 portal 到 body 才不被裁，见 `NotePreview`） */}
      {notePreview.note != null && notePreview.preview != null && (
        <NotePreview
          itemName={itemName(items, notePreview.preview.itemId)}
          content={notePreview.note.content}
          anchorTop={notePreview.preview.top}
          onEnter={notePreview.keepOpen}
          onLeave={notePreview.hoverEnd}
          onOpen={() => {
            const id = notePreview.note?.id;
            notePreview.closeNow();
            if (id != null) void openNoteWindowFor(id);
          }}
        />
      )}
    </div>
  );
}