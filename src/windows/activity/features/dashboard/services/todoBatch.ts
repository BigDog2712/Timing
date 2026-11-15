/**
 * 「新建待办」批量展开（0.13 · 1.7）：**多日期 × 多时刻点**的笛卡尔积，全纯函数。
 *
 * 为什么单独一个文件（不塞进 `todoDraft.ts`）：单条路径的时间口径在 `planTodoWrite`
 * 已经钉死并被判据钉着，批量是另一组校验（日期下限 / 条数上限 / 无槽位），
 * 混在一起两边都会挤破 300 行棘轮。口径仍只落在**一处**：批量展开的每个 plan
 * 的形状就是 `TodoWritePlan`（`plannedAt` / `remindAt`），提醒语义与单条同一条规则
 * —— 勾了提醒 → `remindAt === plannedAt`（同一时刻），不勾 → `null`。
 *
 * ## 为什么"日期下限 = 今天 0 点"是硬校验
 *
 * `jobs/nudge.rs` 的 `purge_overdue` 每 15 s 把 `planned_at < 今天 0 点` 的未完成待办
 * **软删除**（`repositories/todo_nudge.rs:14-30`）。过去的日期不拦的话，症状是
 * 「建了 15 秒内原地消失」——零报错、撤销条都没有。
 *
 * ## 为什么上限 60
 *
 * 5 个日期 × 12 个时刻已经是最重的合法用法（设计 §3.2 `MAX_BATCH = 60`）；
 * Rust 侧 `todo_create_batch` 同值拒收（1..=60），前端先拦省一次 IPC。
 */
import type { TodoWritePlan } from "./todoDraft.ts";

/** 批量上限（Rust `todo_create_batch` 同值：1..=60） */
export const TODO_BATCH_MAX = 60;

/** 校验结果。顺序即优先级：名称 → 槽位 → 格式 → 条数 → 日期下限 → 提醒时刻。 */
export type TodoBatchIssue =
  | "emptyName"
  | "nameTooLong"
  | "noSlot"
  | "timeInvalid"
  | "tooMany"
  | "datePast"
  | "remindPast";

/** 批量弹层的原始输入（**没** trim、**没**解析；日期 `YYYY-MM-DD`、时刻 `HH:mm`） */
export interface TodoBatchDraft {
  title: string;
  /** 勾选的日期（`datetime` 的 `type="date"` 值）；空 = 没选 */
  dates: readonly string[];
  /** 勾选的时刻（`type="time"` 值）；空 = 没选 */
  times: readonly string[];
  /** 「提醒我」勾选状态；true → 每条 plan 的 `remindAt` 与 `plannedAt` 同值 */
  remind: boolean;
}

export interface TodoBatchResult {
  plans: TodoWritePlan[];
  issue: TodoBatchIssue | null;
}

/** `YYYY-MM-DD`（`type="date"` 的 value 格式） */
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `HH:mm`（`type="time"` 的 value 格式） */
const LOCAL_TIME = /^(\d{2}):(\d{2})$/;

/** 本地某日 00:00 的时间戳；脏串 → `null`（调用方判 `timeInvalid`） */
function parseLocalDate(value: string): number | null {
  const match = LOCAL_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > new Date(year, month, 0).getDate()) return null;
  const ms = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** `HH:mm` → 当日分钟数；脏串 / 越界 → `null` */
function parseLocalTime(value: string): number | null {
  const match = LOCAL_TIME.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 批量标题上限镜像 `todoDraft.TODO_TITLE_MAX_CHARS`（同一条后端 1-200 口径） */
const TITLE_MAX = 200;

/**
 * 展开批量草稿。返回 `{plans, issue}`：`issue !== null` 时 `plans` 恒为空数组
 * —— 调用方只看一边，不存在"带病部分展开"。
 *
 * 排期去重：同一 (日期, 时刻) 只出一条 plan（连点两次"添加"把同一时刻加两遍
 * 是操作噪音，不是两个待办）。
 */
export function expandTodoBatch(draft: TodoBatchDraft, nowMs: number): TodoBatchResult {
  const title = draft.title.trim();
  if (title === "") return { plans: [], issue: "emptyName" };
  if (title.length > TITLE_MAX) return { plans: [], issue: "nameTooLong" };

  const dates = [...new Set(draft.dates.map((value) => value.trim()).filter((value) => value !== ""))];
  const times = [...new Set(draft.times.map((value) => value.trim()).filter((value) => value !== ""))];
  if (dates.length === 0 || times.length === 0) return { plans: [], issue: "noSlot" };

  const parsedTimes = (times.map(parseLocalTime) as number[]).sort((left, right) => left - right);
  if (times.some((value) => parseLocalTime(value) === null)) return { plans: [], issue: "timeInvalid" };

  const parsedDates = (dates.map(parseLocalDate) as number[]).sort((left, right) => left - right);
  if (dates.some((value) => parseLocalDate(value) === null)) return { plans: [], issue: "timeInvalid" };

  if (dates.length * times.length > TODO_BATCH_MAX) return { plans: [], issue: "tooMany" };

  const todayStart = startOfLocalDay(nowMs);
  if (parsedDates.some((value) => value < todayStart)) {
    return { plans: [], issue: "datePast" };
  }

  /* 笛卡尔积：**日期升序 × 时刻升序**（去重只管重复，不管顺序）——
     同一天里早上排在前、早的日子排在前，列表与提醒的先后顺序才可预期。 */
  const plans: TodoWritePlan[] = [];
  for (const dateMs of parsedDates) {
    for (const minutes of parsedTimes) {
      const plannedAt = dateMs + minutes * 60_000;
      const remindAt = draft.remind ? plannedAt : null;
      if (draft.remind && plannedAt <= nowMs) return { plans: [], issue: "remindPast" };
      plans.push({ title, plannedAt, remindAt });
    }
  }
  return { plans, issue: null };
}

/** 本地某日 00:00（毫秒）。与 `todoDraft` 的解析同一条"本地钟"纪律：不碰 UTC。 */
function startOfLocalDay(nowMs: number): number {
  const at = new Date(nowMs);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0).getTime();
}

/** `YYYY-MM-DD` → 展示用（本地月/日）。留给 `TodoBatchFields` 的已选 chip 用。 */
export function describeBatchDate(value: string, locale: string): string {
  const ms = parseLocalDate(value);
  if (ms === null) return value;
  return new Date(ms).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}
