/**
 * 「编辑待办」弹层（0.13 · 1.7 的"改"）：单条待办的标题 + 计划时间 + 提醒。
 *
 * 为什么单独成文件：TodosModule 已经 270 行（近 300 棘轮），行键 + 编辑态塞进去必破限；
 * 且编辑弹层与新建弹层（`TodoComposeDialog`）是**两条**路径 —— 新建走
 * `todo_create_batch`（批量），编辑走 `todo_update`（单条、三态 patch），混在一个
 * 文件里两条契约互相干扰。
 *
 * ## 提醒语义与新建同一条规则
 *
 * `planTodoWrite` 的口径照抄：勾了提醒 → `remindAt = plannedAt`（同一时刻）；
 * 不勾 → `remindAt: null`（**显式清空**：Rust `TodoPatch` 的三态里 JSON `null` =
 * `Some(None)` = 清空并复位 `remind_stage`，两级提醒按新时刻重来）。
 * `plannedAt` 为空（不排期）时提醒勾选 disabled —— 没有可提醒的时刻。
 *
 * ## 校验复用 `validateTodoDraft`（单条路径的同一把尺）
 *
 *   `timePast` 只在勾了提醒时拦（宿主 `nudge_due` 的 grace 窗口不会补弹）；
 *   不勾提醒时允许过去时间（补记"昨天该做没做"是合法用法）。
 */
import { useEffect, useId, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import {
  formatDateTimeLocal,
  parseDateTimeLocal,
  TODO_TITLE_MAX_CHARS,
  validateTodoDraft,
  type TodoDraftIssue,
} from "../services/todoDraft.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";

interface Props {
  /** 编辑中的那条；`null` = 弹层关着 */
  todo: TodoSummary | null;
  onClose: () => void;
  /** `useTodayTodos().update`：返回 false = 没改成，弹层留着 */
  update: (
    id: number,
    patch: { title?: string; plannedAt?: number | null; remindAt?: number | null },
  ) => Promise<boolean>;
}

function describeIssue(code: TodoDraftIssue, copy: (typeof DASHBOARD_COPY)["zh-CN"]): string {
  if (code === "emptyName") return copy.timelineNameEmpty;
  if (code === "nameTooLong") return copy.timelineNameTooLong(TODO_TITLE_MAX_CHARS);
  return code === "timePast" ? copy.todoTimePast : copy.todoTimeInvalid;
}

export default function TodoEditDialog({ todo, onClose, update }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const timeId = useId();

  const [name, setName] = useState("");
  const [timeLocal, setTimeLocal] = useState("");
  const [remind, setRemind] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* 打开时以那条待办为初值；`todo === null`（关）时清干净 —— 下一次打开不许残留 */
  useEffect(() => {
    if (todo) {
      setName(todo.title);
      setTimeLocal(todo.plannedAt === null ? "" : formatDateTimeLocal(todo.plannedAt));
      setRemind(todo.remindAt !== null);
    } else {
      setName("");
      setTimeLocal("");
      setRemind(false);
    }
    setIssue(null);
    setBusy(false);
  }, [todo]);

  const hasTime = timeLocal.trim() !== "";
  const plannedAt = hasTime ? parseDateTimeLocal(timeLocal) : null;
  const timeInvalid = hasTime && plannedAt === null;

  const submit = () => {
    if (!todo || busy) return;
    if (timeInvalid) {
      setIssue(copy.todoTimeInvalid);
      return;
    }
    /* `nowMs` 显式传入：`timePast` 的判定可被单测钉住 */
    const code = validateTodoDraft({ title: name, timeLocal, remind, nowMs: Date.now() });
    if (code !== null) {
      setIssue(describeIssue(code, copy));
      return;
    }
    setBusy(true);
    void update(todo.id, {
      title: name.trim(),
      plannedAt,
      /* 与 `planTodoWrite` 同一条口径：勾提醒 = `remindAt === plannedAt`；不勾 = 显式 null。
         `null` 显式发出（= 清排期 / 清提醒并复位 `remind_stage`），不是省略键。 */
      remindAt: remind && plannedAt !== null ? plannedAt : null,
    }).then((accepted) => {
      setBusy(false);
      if (!accepted) {
        setIssue(copy.todoCreateFailed);
        return;
      }
      onClose();
    });
  };

  return (
    <QuietDialog
      open={todo !== null}
      title={copy.todoEditTitle}
      surfaceClassName="qp-todo-dialog"
      initialFocusRef={nameRef}
      onClose={onClose}
      actions={(
        <>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-secondary"
            onClick={onClose}
          >
            {UI_TEXT.dialog.cancel}
          </button>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-primary"
            disabled={busy || name.trim().length === 0}
            onClick={submit}
          >
            {UI_TEXT.dialog.confirm}
          </button>
        </>
      )}
    >
      <form
        className="qp-todo-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="qp-todo-field">
          <label className="qp-todo-field-label" htmlFor={nameId}>{copy.todoNameLabel}</label>
          <input
            id={nameId}
            ref={nameRef}
            className="qp-input qp-todo-name-input"
            value={name}
            maxLength={TODO_TITLE_MAX_CHARS}
            aria-label={copy.todoNameLabel}
            aria-invalid={issue !== null || undefined}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setIssue(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        </div>

        <div className="qp-todo-field">
          <label className="qp-todo-field-label" htmlFor={timeId}>{copy.todoTimeLabel}</label>
          <div className="qp-todo-time-row">
            <input
              id={timeId}
              type="datetime-local"
              className="qp-input qp-todo-time-input"
              value={timeLocal}
              aria-invalid={timeInvalid || undefined}
              onChange={(event) => {
                /* 原样存字符串：让 React/`Date` 去解析就会串时区（见 `todoDraft.ts` 文件头） */
                setTimeLocal(event.target.value);
                setIssue(null);
              }}
            />
            {hasTime ? (
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-secondary"
                onClick={() => {
                  /* 清空时间 = 不排期，连带取消提醒 */
                  setTimeLocal("");
                  setRemind(false);
                  setIssue(null);
                }}
              >
                {copy.todoTimeClear}
              </button>
            ) : null}
          </div>
        </div>

        <label className="qp-todo-remind">
          <input
            type="checkbox"
            checked={remind}
            disabled={!hasTime}
            onChange={(event) => {
              setRemind(event.target.checked);
              setIssue(null);
            }}
          />
          <span>{copy.todoRemindLabel}</span>
        </label>

        {!hasTime ? (
          <p className="qp-todo-hint">{copy.todoRemindNeedsTime}</p>
        ) : remind ? (
          <p className="qp-todo-hint">{copy.todoRemindHint}</p>
        ) : null}

        {issue ? <p className="qp-todo-issue" role="status">{issue}</p> : null}
      </form>
    </QuietDialog>
  );
}
