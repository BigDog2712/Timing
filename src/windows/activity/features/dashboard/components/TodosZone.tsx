/**
 * 今日时间线卡 · **下区 = 待办**（2026-11-20 从上半块换到下半块）。
 *
 * 这一区就是 0.12.5 的待办卡内容，原样搬进时间线卡的下半块：
 * 区标题（`待办事项`）+ 量出来的「N 条待办 / 还有 K 项 ▸」+ 「新建待办」紧凑行 +
 * 四态（loading / error / empty / 列表）+ 3 秒撤销条 + 两个弹层。
 *
 * ## 三个不改的判据（都是从待办卡继承来的，别在这里"优化"掉）
 *
 *   ① **四态之外常驻「新建待办」**：空态（今天一条待办都没有）恰恰是最想新建的时刻，
 *      把入口放进 empty 分支里，用户看到的就只是一句"今天还没有待办"。
 *   ② **溢出条数是量出来的**（`clientHeight` / `offsetTop` 推可见行数），不按档位写死 ——
 *      同一张卡 S/M/L 三档高度差一倍，写死的数字在任何一档都是错的。
 *   ③ **撤销条出现即抢焦点**（与主窗 `TodoUndoBar.tsx` 同口径）：键盘用户按完删除，
 *      焦点必须落在「撤销」上，否则 3 秒过去了他还不知道自己删了什么。
 *
 * ## 数据一条都不自己取
 *
 * `useTodayTodos` 在 `Dashboard.tsx` 提起（E5 的 `hasAnyData()` 必须看得见待办源），
 * 这里只收模型 —— 卡里多发一条 IPC，首屏就多一次等。
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";
import { applyTodoItemExtras } from "../services/todoItemExtras.ts";
import { moduleState, type ModuleState } from "./ModuleShell.tsx";
import TodoComposeDialog from "./TodoComposeDialog.tsx";
import TodoEditDialog from "./TodoEditDialog.tsx";
import TodoRow from "./TodoRow.tsx";

interface Props {
  /** 待办源（`useTodayTodos` 的模型，由 `Dashboard` 提起后传进来） */
  todosModel: TodayTodosState;
  /** E3：快照刷新失败（卡内小图标；与待办源自己的刷新失败共用一处） */
  refreshError: boolean;
}

export default function TodosZone({ todosModel, refreshError }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  /* 同一张卡可以放多张：区标题 id 带实例后缀，不然两份 `t-todos-zone` 的
     aria-labelledby 会指到先出现的那一张（`withInstance` 与 `ModuleShell` 同口径）。 */
  const domId = withInstance("t-todos-zone", useBoardInstance());
  const { todos, status, pending, toggle, remove, undoPending, retry } = todosModel;

  const [composeOpen, setComposeOpen] = useState(false);
  /** 正在编辑的那条待办；`null` = 编辑弹层关着 */
  const [editingTodo, setEditingTodo] = useState<TodoSummary | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [fadeVisible, setFadeVisible] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);

  const openTodos = todos.filter((todo) => todo.doneAt === null);

  /* 唯一的推导入口：可见整行数 + 底部渐隐（02 §4.2 #1 / #2）。RO 回调、scroll、
     列表变化三处都调它，谁也不许自己再算一遍。 */
  const syncDerived = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    const rowHeight = rows[0]?.offsetHeight ?? 0;
    const pitch = rows.length >= 2 ? rows[1].offsetTop - rows[0].offsetTop : rowHeight;
    const visible = pitch > 0
      ? Math.floor((list.clientHeight - rowHeight) / pitch) + 1
      : rows.length;
    setHiddenCount(Math.max(0, rows.length - visible));
    setFadeVisible(list.scrollHeight > list.clientHeight + 1
      && list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  }, []);

  useLayoutEffect(() => {
    syncDerived();
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => syncDerived());
    observer.observe(list);
    const onScroll = () => syncDerived();
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", onScroll);
    };
  }, [syncDerived, todos.length]);

  /* 撤销条出现即把焦点交给「撤销」（与主窗 TodoUndoBar.tsx:20-24 同口径） */
  useLayoutEffect(() => {
    if (pending) undoRef.current?.focus();
  }, [pending]);

  /* 有行 + error = 刷新失败（E3）；无行 + error = 模块级错误（E2）。同一个 status 派生，
     与 `ModuleShell` 的谓词共用一份实现（`moduleState`），不在这里另写一遍。 */
  const todosRefreshError = status === "error" && openTodos.length > 0;
  const state: ModuleState = moduleState(status, todosRefreshError, openTodos.length === 0);

  return (
    <div
      className="at-items-zone at-items-zone-todos"
      data-zone="todos"
      data-state={state}
      aria-labelledby={domId}
    >
      {/* ── 区标题行：标题 + 量出来的待办读数 ── */}
      <div className="at-items-zone-head">
        <h3 className="at-items-zone-title" id={domId}>{copy.todosTitle}</h3>
        {openTodos.length > 0 ? (
          <span className="at-todo-meta">
            <span>{copy.todosMeta(openTodos.length)}</span>
            {hiddenCount > 0 ? <span>{copy.todosRest(hiddenCount)}</span> : null}
          </span>
        ) : null}
        {todosRefreshError || refreshError ? (
          <span className="at-refresh-error" data-error-layer="refresh" role="alert" title={UI_TEXT.common.refreshFailed}>
            <span className="sr-only">{UI_TEXT.common.refreshFailed}</span>
          </span>
        ) : null}
      </div>

      {/* 「新建待办」那一行：四态常驻（空态正是最该看到的时刻），高度 24 的紧凑行 */}
      <div className="at-todo-new-row">
        <button type="button" className="at-link-btn" onClick={() => setComposeOpen(true)}>
          {copy.todoNewTodo}
        </button>
      </div>

      {state === "loading" ? (
        <div className="at-skeleton" data-row="todo" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
      ) : state === "error" ? (
        <div className="at-module-error" role="alert" data-error-layer="module">
          <p className="at-module-error-text">{UI_TEXT.common.readFailed}</p>
          <button type="button" className="at-link-btn" onClick={retry}>
            {UI_TEXT.common.retry}
          </button>
        </div>
      ) : state === "empty" ? (
        <p className="at-empty">{copy.todosEmpty}</p>
      ) : (
        <>
          <ul className="at-todo-list at-scroll-region at-scroll-region-stable" ref={listRef}>
            {openTodos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} onToggle={toggle} onRemove={remove} onEdit={setEditingTodo} />
            ))}
          </ul>
          {fadeVisible ? <div className="at-fade-bottom" /> : null}
        </>
      )}

      {pending ? (
        <div className="at-undo-bar" role="status">
          <span className="at-undo-text" title={pending.todo.title}>
            {pending.kind === "delete"
              ? copy.undoDeleted(pending.todo.title)
              : copy.undoToggled(pending.todo.title)}
          </span>
          <button ref={undoRef} type="button" className="at-undo-btn" onClick={undoPending}>
            {copy.undoAction}
          </button>
        </div>
      ) : null}

      {/* 弹层是本区根节点的**兄弟**：挂在四态分支里，空态下点「新建待办」就什么都不会出来 */}
      <TodoEditDialog todo={editingTodo} onClose={() => setEditingTodo(null)} update={todosModel.update} />
      <TodoComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        createBatch={todosModel.createBatch}
        onItemExtras={(title, extras) => applyTodoItemExtras(title, extras).catch(() => undefined)}
      />
    </div>
  );
}
