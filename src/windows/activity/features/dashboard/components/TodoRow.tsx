/**
 * 待办卡的**一行**（0.13 · 1.7 从 `TodosModule` 抽出来）—— 那个文件近 300 行棘轮，
 * 行渲染（勾选 / 标题 / 铃铛 / 时间胶囊 / 删除 / [本轮] 编辑）是自成一体的展示层。
 *
 * 纯展示：一切写动作经 props 回调（勾选 / 删除 / 编辑），行体单击开独立待办窗。
 * 三条既有纪律原样保留：
 *   · 行内两颗键各自 `stopPropagation`，否则点勾选/删除会顺带开窗；
 *   · 勾选框的 `aria-label` 随 `aria-checked` 换词（06 A9⑤）；
 *   · 排期时间只画时分（24 小时制）；没排期就不画胶囊 —— 无条件渲染空框
 *     会被当成"加载失败的占位"。
 */
import { Bell, Pencil, X } from "lucide-react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import { reminderClock } from "../services/todoDraft.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import { DASHBOARD_COPY } from "../copy.ts";

const DAY_MS = 86_400_000;

function clockOf(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

interface Props {
  todo: TodoSummary;
  onToggle: (id: number, done: boolean) => void;
  onRemove: (id: number) => void;
  onEdit: (todo: TodoSummary) => void;
}

export default function TodoRow({ todo, onToggle, onRemove, onEdit }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const done = todo.doneAt !== null;
  return (
    <li
      className="qp-todo-row"
      data-done={done || undefined}
      /* 行体单击开独立待办窗（06 T12）。走 patina:host-intent 事件桥
       * （{action:'open_todos'}），不是新 IPC 命令 —— 契约不动、L9 不破。 */
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
          onToggle(todo.id, !done);
        }}
      >
        <span className="qp-todo-box" aria-hidden="true" />
      </button>
      <span className="qp-todo-title" title={todo.title}>{todo.title}</span>
      {/* [本轮] 提醒标记：`remindAt` 非 null 才画（宿主两级提醒以它为基准）。 */}
      <span className="qp-todo-when">
        {todo.remindAt !== null ? (
          <span
            className="qp-todo-bell"
            role="img"
            aria-label={copy.todoRemindAt(reminderClock(todo.remindAt))}
          >
            <Bell size={12} strokeWidth={2.5} aria-hidden="true" />
          </span>
        ) : null}
        <PlannedChip plannedAt={todo.plannedAt} done={done} locale={locale} />
      </span>
      {/* [本轮] 编辑键：打开单条编辑弹层（标题 + 计划时间 + 提醒，`todo_update`）。
          与删除键同款绝对定位区，不参与 grid 列宽。 */}
      <button
        type="button"
        className="qp-todo-edit"
        aria-label={`${copy.todoEdit} ${todo.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(todo);
        }}
      >
        <Pencil size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="qp-todo-del"
        aria-label={copy.todoDelete(todo.title)}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(todo.id);
        }}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * 计划时刻胶囊：**没排期就不画**，四种状态各自一套色（逐条照 `todos.rs:76-100`）：
 *   · 已完成 → 灰字、无底；· 逾期 → danger 色 + 淡底；· 今天 → accent 淡底；
 *   · 更远的日期 → 换成日期（"11/13"），不带底。
 */
function PlannedChip({ plannedAt, done, locale }: { plannedAt: number | null; done: boolean; locale: string }) {
  if (plannedAt === null) return null;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();

  if (done) {
    return <span className="qp-todo-time" data-state="done">{clockOf(plannedAt)}</span>;
  }
  if (plannedAt < start) {
    return <span className="qp-todo-time" data-state="overdue">{clockOf(plannedAt)}</span>;
  }
  if (plannedAt < start + DAY_MS) {
    return <span className="qp-todo-time">{clockOf(plannedAt)}</span>;
  }
  const text = new Date(plannedAt).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  return <span className="qp-todo-time" data-state="later">{text}</span>;
}
