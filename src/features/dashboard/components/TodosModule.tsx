import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";

/**
 * 模块 4 · 待办事项（01 §4.3 骨架：head / compose / list / fade / undo）
 *
 * ## 「还有 N 项」的 N 是**量出来的**，不是写死的
 *
 * 02 §4.2 #1 点名了这一处：可见整行数 = f(卡高, 行高, gap)，两档不同（5 / 4 行），
 * 一旦有人改 `--qp-row-todo` 或卡高，写死的 4 会立刻错。这里用一个 `ResizeObserver`
 * 挂在列表上，pitch 从第 1、2 行的 `offsetTop` 差里读，**不读 CSS 变量、不算魔法数**：
 *   visible = floor((clientHeight − rowH) / pitch) + 1     // 末行不需要 trailing gap
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
  /** 待办是**独立源**：它自己的三态与数据都在这个 model 里（hook 由 `Dashboard` 提起，
   *  因为 E5 的 `hasAnyData()` 必须能看见它） */
  model: TodayTodosState;
}

export default function TodosModule({ model }: Props) {
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  const { todos, status, pending, create, toggle, remove, undoPending, retry } = model;
  const [draft, setDraft] = useState("");
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
      meta={(
        <>
          <span>{copy.todosAll(todos.length)}</span>
          {hiddenCount > 0 ? <span>{copy.todosRest(hiddenCount)}</span> : null}
        </>
      )}
    >
      <form
        className="qp-todo-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void create(draft).then((accepted) => { if (accepted) setDraft(""); });
        }}
      >
        <span className="qp-compose-icon" aria-hidden="true">
          <Plus size={14} strokeWidth={2} />
        </span>
        <input
          value={draft}
          placeholder={copy.todoCompose}
          /* label 与 placeholder 必须两串：placeholder 里的「…」会被读屏读出来（06 T6） */
          aria-label={copy.todoComposeLabel}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            /* Esc（06 T4/T5）：有字→清空；无字→焦点去列表首行。
             * 不 preventDefault：Esc 在输入框没有默认行为要拦。 */
            if (event.key !== "Escape") return;
            if (draft.trim() !== "") {
              setDraft("");
            } else {
              listRef.current?.querySelector<HTMLElement>(".qp-todo-check")?.focus();
            }
          }}
        />
      </form>

      <ul className="qp-todo-list qp-scroll-region qp-scroll-region-stable" ref={listRef}>
        {todos.map((todo) => {
          const done = todo.doneAt !== null;
          return (
            <li
              key={todo.id}
              className="qp-todo-row"
              data-done={done || undefined}
              /* 行体单击开独立待办窗（06 T12）。走 patina:host-intent 事件桥
               * （{action:'open_todos'}），不是新 IPC 命令 —— 契约不动、L9 不破。
               * 行内两个键各自 stopPropagation，否则点勾选/删除会顺带开窗。 */
              onClick={() => { void emitHostIntent({ action: "open_todos" }); }}
            >
              <button
                type="button"
                className="qp-todo-check"
                role="checkbox"
                aria-checked={done}
                /* label 必须随状态换词：已完成的事再读「完成」会让读屏用户重做一遍（06 A9⑤） */
                aria-label={done ? copy.todoUntoggle(todo.title) : copy.todoToggle(todo.title)}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(todo.id, !done);
                }}
              >
                <span className="qp-todo-box" aria-hidden="true" />
              </button>
              <span className="qp-todo-title" title={todo.title}>{todo.title}</span>
              <span className="qp-todo-time">{formatPlannedLabel(todo.plannedAt)}</span>
              <button
                type="button"
                className="qp-todo-del"
                aria-label={copy.todoDelete(todo.title)}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(todo.id);
                }}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          );
        })}
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

/** 排期时间只画时分（24 小时制，本地时区）；没排期就空着，不写「未排期」占位 */
function formatPlannedLabel(plannedAt: number | null): string {
  if (plannedAt === null) return "";
  const date = new Date(plannedAt);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
