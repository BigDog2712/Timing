/**
 * 「新建待办」弹层 —— [本轮] 与「新建事项」完全对齐的入口。
 *
 * 用户口径（原话）：「新增代办应与新增事项一致 可以填写时间 选择是否提醒」。
 * [0.13 · 1.7] 时间区升级为**多日期 × 多时刻**（`TodoBatchFields`，chip 流）：
 * 一条「统一添加」= 日期 × 时刻的笛卡尔积，**一条** `todo_create_batch` 落库
 * （后端单事务，任一失败整批回滚——前端循环 `todo_create` 会出现"只加了一半"）。
 * 展开与校验的口径只在 `services/todoBatch.expandTodoBatch` 一处；这里不写三元。
 *
 * ## 「不勾提醒」必须落 null
 *
 * 宿主两级提醒（`src-tauri/src/services/todo_nudge.rs:3-9`：T-15 轻提醒、T-5 问
 * 「当前结束后自动开始？」）以 `remind_at` 为基准。勾了 → 每条 plan 的
 * `remindAt === plannedAt`（同一时刻）；不勾 → `remindAt: null`。
 *
 * ## 三条失败路径都不许"演成功"
 *
 *   · 校验不过 → 就地一句提示，**不发请求**（`expandTodoBatch` 的 issue）；
 *   · `createBatch` 返回 false（IPC 抛错）→ 弹层**不关**、草稿**一个字不清**，显示
 *     `todoCreateFailed`；用户重试不用重打一遍；
 *   · 成功 → 清草稿 + 关弹层（下一次打开是干净的一张空表单）。
 *
 * Esc / 取消 / 点遮罩：走同一个 `handleClose`（清草稿 + 关），三条路径不能有一条忘了清。
 */
import { useId, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import { TODO_TITLE_MAX_CHARS } from "../services/todoDraft.ts";
import {
  expandTodoBatch,
  TODO_BATCH_MAX,
  type TodoBatchIssue,
} from "../services/todoBatch.ts";
import type { TodoWritePlan } from "../services/todoDraft.ts";
import TodoBatchFields from "./TodoBatchFields.tsx";

interface Props {
  open: boolean;
  /** 关弹层（父组件把 `open` 置 false）；调用前草稿已清 */
  onClose: () => void;
  /** `useTodayTodos().createBatch`：返回 false = 没建成（失败），弹层要留着 */
  createBatch: (plans: readonly TodoWritePlan[]) => Promise<boolean>;
}

/** issue → 一句人话。名称类复用 `copyTimeline` 的同义句（同一个后端 1-200 口径）。 */
function describeIssue(code: TodoBatchIssue, copy: (typeof DASHBOARD_COPY)["zh-CN"]): string {
  if (code === "emptyName") return copy.timelineNameEmpty;
  if (code === "nameTooLong") return copy.timelineNameTooLong(TODO_TITLE_MAX_CHARS);
  if (code === "noSlot") return copy.todoBatchNeedBoth;
  if (code === "timeInvalid") return copy.todoBatchTimeInvalid;
  if (code === "tooMany") return copy.todoBatchTooMany(TODO_BATCH_MAX);
  if (code === "datePast") return copy.todoBatchDatePast;
  return copy.todoBatchRemindPast;
}

export default function TodoComposeDialog({ open, onClose, createBatch }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  const [name, setName] = useState("");
  const [dates, setDates] = useState<readonly string[]>([]);
  const [times, setTimes] = useState<readonly string[]>([]);
  const [remind, setRemind] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim() !== "" && !busy;

  const resetDraft = () => {
    setName("");
    setDates([]);
    setTimes([]);
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
    /* `nowMs` 显式传入：`datePast` / `remindPast` 的判定被单测钉住 */
    const result = expandTodoBatch({ title: name, dates, times, remind }, Date.now());
    if (result.issue !== null) {
      setIssue(describeIssue(result.issue, copy));
      return;
    }
    setBusy(true);
    void createBatch(result.plans).then((accepted) => {
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
              /* 表单里有多个会拦隐式提交的字段且没有 submit 键，
                 所以 Enter 必须自己接：这里不 `preventDefault` 会再触发一次 onSubmit。 */
              event.preventDefault();
              submit();
            }}
          />
        </div>

        <TodoBatchFields
          dates={dates}
          times={times}
          onDatesChange={setDates}
          onTimesChange={setTimes}
        />

        <label className="qp-todo-remind">
          <input
            type="checkbox"
            checked={remind}
            onChange={(event) => {
              setRemind(event.target.checked);
              setIssue(null);
            }}
          />
          <span>{copy.todoRemindLabel}</span>
        </label>

        {/* 勾上之后说清宿主真实行为（提前 15 / 5 分钟两档），不是"到点提醒" */}
        {remind ? <p className="qp-todo-hint">{copy.todoRemindHint}</p> : null}

        {issue ? <p className="qp-todo-issue" role="status">{issue}</p> : null}
      </form>
    </QuietDialog>
  );
}
