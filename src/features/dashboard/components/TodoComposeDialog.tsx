/**
 * 「新建待办」弹层 —— [本轮] 与「新建事项」完全对齐的入口。
 *
 * 用户口径（原话）：「新增代办应与新增事项一致 可以填写时间 选择是否提醒」。
 * 落地成**一个时间 + 一个勾选**：
 *   · 「计划时间」→ `plannedAt`（行上时间胶囊 / 逾期红字都读它），可以为空 = 不排期；
 *   · 「提醒我」→ 勾了就把**同一时刻**也写进 `remindAt`，不勾则 `remindAt = null`。
 *     时间口径只有一处实现（`services/todoDraft.ts` 的 `planTodoWrite`），这里**不写三元**。
 *
 * ## 为什么"不勾提醒"必须落 null
 *
 * 宿主两级提醒（`src-tauri/src/services/todo_nudge.rs:3-9`：T-15 轻提醒、T-5 问
 * 「当前结束后自动开始？」）以 `remind_at` 为基准。无脑两处都写 = 每条待办在开始前
 * 弹两次；而这个卡上的待办大多是"随手记一条"，绝大多数根本不需要提醒。
 *
 * ## 三条失败路径都不许"演成功"
 *
 *   · 校验不过 → 就地一句提示，**不发请求**（`validateTodoDraft`）；
 *   · `create` 返回 false（IPC 抛错）→ 弹层**不关**、草稿**一个字不清**，显示
 *     `todoCreateFailed`；用户重试不用重打一遍；
 *   · 成功 → 清草稿 + 关弹层（下一次打开是干净的一张空表单）。
 *
 * Esc / 取消 / 点遮罩：走同一个 `handleClose`（清草稿 + 关），三条路径不能有一条忘了清。
 */
import { useId, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import {
  TODO_TITLE_MAX_CHARS,
  planTodoWrite,
  validateTodoDraft,
  type TodoDraftIssue,
} from "../services/todoDraft.ts";

interface Props {
  open: boolean;
  /** 关弹层（父组件把 `open` 置 false）；调用前草稿已清 */
  onClose: () => void;
  /** `useTodayTodos().create`：返回 false = 没建成（失败或空名），弹层要留着 */
  create: (title: string, plannedAt: number | null, remindAt: number | null) => Promise<boolean>;
}

export default function TodoComposeDialog({ open, onClose, create }: Props) {
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

  /** 时间是否填了：决定「提醒」勾选能不能点（没时间就没有可提醒的时刻） */
  const hasTime = timeLocal.trim() !== "";
  /** 空名不许提交：按钮 `disabled`，不是提交后弹一句错误 */
  const canSubmit = name.trim() !== "" && !busy;

  /** 四条校验结果 → 一句人话。空名/超长复用 `copyTimeline` 的同义句（同一个后端 1-200 口径） */
  const describeIssue = (code: TodoDraftIssue): string => {
    if (code === "emptyName") return copy.timelineNameEmpty;
    if (code === "nameTooLong") return copy.timelineNameTooLong(TODO_TITLE_MAX_CHARS);
    return code === "timePast" ? copy.todoTimePast : copy.todoTimeInvalid;
  };

  const resetDraft = () => {
    setName("");
    setTimeLocal("");
    setRemind(false);
    setIssue(null);
    setBusy(false);
  };

  /** 唯一关闭口：先清草稿再关（取消 / Esc / 遮罩 / 建成之后都走这里） */
  const handleClose = () => {
    resetDraft();
    onClose();
  };

  const submit = () => {
    if (busy) return;
    /* `nowMs` 显式传入而不是在纯函数里取 `Date.now()`：`validateTodoDraft` 要能被单测钉住 */
    const code = validateTodoDraft({ title: name, timeLocal, remind, nowMs: Date.now() });
    if (code !== null) {
      setIssue(describeIssue(code));
      return;
    }
    const plan = planTodoWrite({ title: name, timeLocal, remind });
    setBusy(true);
    void create(plan.title, plan.plannedAt, plan.remindAt).then((accepted) => {
      setBusy(false);
      if (!accepted) {
        /* 失败：弹层不关、草稿不清 —— 用户改一个字段再点一次就行，不用重打 */
        setIssue(copy.todoCreateFailed);
        return;
      }
      resetDraft();
      onClose();
    });
  };

  /** 清空时间 = 不排期，**连带把提醒也取消**：没时间就没有可提醒的时刻 */
  const clearTime = () => {
    setTimeLocal("");
    setRemind(false);
    setIssue(null);
  };

  return (
    <QuietDialog
      open={open}
      title={copy.todoCreateTitle}
      surfaceClassName="qp-todo-dialog"
      initialFocusRef={nameRef}
      onClose={handleClose}
      actions={(
        <>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-secondary"
            onClick={handleClose}
          >
            {UI_TEXT.dialog.cancel}
          </button>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-primary"
            disabled={!canSubmit}
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
          <label className="qp-todo-field-label" htmlFor={nameId}>
            {copy.todoNameLabel}
          </label>
          <input
            id={nameId}
            ref={nameRef}
            className="qp-input qp-todo-name-input"
            value={name}
            maxLength={TODO_TITLE_MAX_CHARS}
            placeholder={copy.todoCompose}
            aria-label={copy.todoNameLabel}
            aria-invalid={issue !== null || undefined}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setIssue(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              /* 表单里有两个会拦隐式提交的字段（text + datetime-local）且没有 submit 键，
                 所以 Enter 必须自己接：这里不 `preventDefault` 会再触发一次 onSubmit。 */
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
              onChange={(event) => {
                /* 原样存字符串：让 React/`Date` 去解析就会串时区（见 `todoDraft.ts` 的文件头） */
                setTimeLocal(event.target.value);
                setIssue(null);
              }}
            />
            {hasTime ? (
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-secondary"
                onClick={clearTime}
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

        {/* 勾不了的时候必须解释为什么（灰着不解释 = 用户以为坏了）；
            勾上之后说清宿主真实行为（提前 15 / 5 分钟两档），不是"到点提醒" */}
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
