import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import TodoComposeDialog from "./TodoComposeDialog.tsx";
import TodoEditDialog from "./TodoEditDialog.tsx";
import TodoRow from "./TodoRow.tsx";

/**
 * 模块 4 · 待办事项（01 §4.3 骨架：head / list / fade / undo / footer）
 *
 * ## 新建入口 = 卡底「＋ 新建待办」弹层（[本轮]，与「新建事项」完全对齐）
 *
 * 顶部的行内输入行下线了：用户口径「新增代办应与新增事项一致，可以填写时间，
 * 选择是否提醒」。一个时间（`plannedAt`）+ 一个勾选（勾了才有 `remindAt`）装不进
 * 32px 的行内输入，所以挪进 `TodoComposeDialog`（挂在 `ModuleShell` 的 `footer` 里 ——
 * footer 在 empty / error 态也在场，「今天还没有待办」恰恰是最需要新建入口的时刻）。
 * 时间口径的唯一实现在 `services/todoDraft.ts` 的 `planTodoWrite`，这里不写三元。
 *
 * ## 「还有 N 项」的 N 是**量出来的**，不是写死的
 *
 * 02 §4.2 #1 点名了这一处：可见整行数 = f(卡高, 行高, gap)，两档不同（5 / 4 行），
 * 一旦有人改 `--qp-row-todo` 或卡高，写死的 4 会立刻错。这里用一个 `ResizeObserver`
 * 挂在列表上，pitch 从第 1、2 行的 `offsetTop` 差里读，**不读 CSS 变量、不算魔法数**：
 *   visible = floor((clientHeight − rowH) / pitch) + 1     // 末行不需要 trailing gap
 *
 * 卡底加了 footer 之后这套测量**照常工作**：可见行数从量出来的 clientHeight 推，
 * 「还有 K 项」自动适配，不需要跟着改任何数字。
 *
 * 两个推导量（可见行数、底部渐隐）由**同一个** `syncTodoDerived()` 算，它是一个可同步
 * 调用的普通函数：`useLayoutEffect`（列表变了）、RO 回调（容器变了）、`scroll`（滚动位置
 * 变了）三处都调它，谁也不许自己再算一遍。无头环境里 RO 只投递一次，所以 RO 的投递次数
 * 会在 DEV 下打点 —— 用它可以区分"RO 没来"和"算法错"。
 *
 * ## 删除为什么是"乐观 + 3s 撤销"而不是二次确认
 *
 * 照抄主窗 AC-32（`todoStore.ts:10-13`）：后端没有 `todo_restore`，"撤销"只能是
 * "还没删"。3s 窗内撤销 = 本地恢复、一次都不落库。
 *
 * ## 一行一个 `todo.id`
 *
 * 勾选/删除都按 **id** 传（`toggle(id, done)` / `remove(id)`），列表里没有一处用下标；
 * `key` 也是 id。这样增删过程中闭包抓到的那一行不会错位。
 *
 * ## 行内删除键只在 hover / 键盘聚焦时出现
 *
 * 它**绝对定位盖在时间列上**，不参与 grid 列宽 —— 否则 44px 的数字列会被挤窄，
 * 四条数字列右缘 443.14/548.86 的验收值立刻失效。
 */
interface Props {
  controls?: ReactNode;
  /** 待办是**独立源**：它自己的三态与数据都在这个 model 里（hook 由 `Dashboard` 提起，
   *  因为 E5 的 `hasAnyData()` 必须能看见它） */
  model: TodayTodosState;
}

export default function TodosModule({ controls, model }: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const { todos, status, pending, toggle, remove, undoPending, retry } = model;
  const [composeOpen, setComposeOpen] = useState(false);
  /** 正在编辑的那条；`null` = 编辑弹层关着（[0.13 · 1.7] 行上的「编辑」键） */
  const [editingTodo, setEditingTodo] = useState<TodoSummary | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [fadeVisible, setFadeVisible] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const deliveriesRef = useRef(0);

  /** 唯一的推导入口：可见整行数 + 底部渐隐（02 §4.2 #1 / #2） */
  const syncTodoDerived = useCallback(() => {
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
    syncTodoDerived();
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(() => {
      deliveriesRef.current += 1;
      if (import.meta.env.DEV) {
        console.debug("[dashboard] todo RO 投递", deliveriesRef.current);
      }
      syncTodoDerived();
    });
    observer.observe(list);
    const onScroll = () => syncTodoDerived();
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", onScroll);
    };
  }, [syncTodoDerived, todos.length]);

  /* 撤销条出现即把焦点交给「撤销」（与主窗 TodoUndoBar.tsx:20-24 同口径） */
  useLayoutEffect(() => {
    if (pending) undoRef.current?.focus();
  }, [pending]);

  /* 有行 + error = 刷新失败（E3 小图标）；无行 + error = 模块级错误（E2）。同一个 status 派生 */
  const refreshError = status === "error" && todos.length > 0;
  const state = moduleState(status, refreshError, todos.length === 0 && pending === null);

  return (
    <ModuleShell
      controls={controls}
      id="t-todos"
      title={copy.todosTitle}
      className="qp-card-todos"
      state={state}
      skeletonRows={5}
      skeletonRow="todo"
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={retry}
      refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
      emptyText={copy.todosEmpty}
      /* 三段式：① 无（加载 / 空） ② `全部 N 项 ▸` 常驻 ③ 溢出时再加 `还有 K 项 ▸`。
      两个 N 是**两个数**（总数 / 没排下的条数），谁也不许拿另一个推。
      （ready 态必然 todos.length > 0：0 条会被 moduleState 判成 empty。） */
      /* 卡头读数 = exe 的 `meta(Todos)`：「N 条待办」（`widgets/mod.rs:156`）。
         溢出条数仍要说，但只在真的溢出时追加一段，不再是常驻的「全部 N 项 ▸」。 */
      meta={(
        <>
          <span>{copy.todosMeta(todos.filter((todo) => todo.doneAt === null).length)}</span>
          {hiddenCount > 0 ? <span>{copy.todosRest(hiddenCount)}</span> : null}
        </>
      )}
      /* [本轮] 卡底写入口放 **footer** 而不是 children：children 只在 ready 渲染，
         而「今天还没有待办」正是最想新建一条的时刻（`ModuleShell` 的 footer 注释）。
         弹层也挂在 footer 里（照 `TimelineCard.tsx` 的 `qp-timeline-manage`）。 */
      footer={(
        <div className="qp-todo-foot">
          <button type="button" className="qp-link-btn" onClick={() => setComposeOpen(true)}>
            {copy.todoNewTodo}
          </button>
          <TodoComposeDialog
            open={composeOpen}
            onClose={() => setComposeOpen(false)}
            createBatch={model.createBatch}
          />
        </div>
      )}
    >
      {/* [0.13 · 1.7] 行编辑弹层作为第一个 child：children 只在 ready 渲染，而编辑
          必须有一条待办才开（ready 态必有行）—— 弹层自身 open 门控（`todo === null`
          时不渲染表面），所以放 children 里不会把空态/骨架挡掉。 */}
      <TodoEditDialog
        todo={editingTodo}
        onClose={() => setEditingTodo(null)}
        update={model.update}
      />
      <ul className="qp-todo-list qp-scroll-region qp-scroll-region-stable" ref={listRef}>
        {todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onToggle={toggle}
            onRemove={remove}
            onEdit={setEditingTodo}
          />
        ))}
      </ul>

      {fadeVisible ? <div className="qp-fade-bottom" /> : null}

      {pending ? (
        <div className="qp-undo-bar" role="status">
          <span className="qp-undo-text" title={pending.todo.title}>
            {pending.kind === "delete" ? copy.undoDeleted(pending.todo.title) : copy.undoToggled(pending.todo.title)}
          </span>
          <button ref={undoRef} type="button" className="qp-undo-btn" onClick={undoPending}>
            {copy.undoAction}
          </button>
        </div>
      ) : null}
    </ModuleShell>
  );
}

