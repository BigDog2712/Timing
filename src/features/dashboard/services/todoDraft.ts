/**
 * 「新建待办」的时间口径与校验 —— 全纯函数：没有 React、没有 IPC、**没有 `Date.now()` 默认值**。
 *
 * ## 为什么单独一个文件
 *
 * 用户口径（原话）：「新增代办应与新增事项一致 可以填写时间 选择是否提醒」。
 * 这条需求里唯一容易写错、且写错之后**不报错**的东西是"一个时间落到两个字段"的口径：
 *   · `planned_at` —— 行上那颗时间胶囊、逾期红字都靠它；
 *   · `remind_at`  —— 宿主两级提醒（T-15 轻提醒 / T-5 问「当前结束后自动开始？」，
 *     `src-tauri/src/services/todo_nudge.rs:3-9`）的基准。
 *
 * 所以口径只有一处实现（`planTodoWrite`），组件里不许再写一遍三元；判据在
 * `todoDraft.test.ts`（`plannedAt === remindAt` / `remindAt === null` 两条）。
 *
 * ## 时间字符串为什么手解
 *
 * `datetime-local` 的 value 是**本地**墙上时间 `YYYY-MM-DDTHH:mm`（没有时区后缀）。
 * `new Date(string)` 对这种脏串各引擎的宽松解析不一致（有的按 UTC、有的按本地、
 * 有的直接 Invalid），`toISOString()` 更是把本地时间当 UTC 输出 —— 差一个时区，
 * 用户填 21:00 会在胶囊上看到 13:00。所以：
 *   · 输出（`formatDateTimeLocal`）= 本地 getter 手拼，**禁 `toISOString`**；
 *   · 输入（`parseDateTimeLocal`）= 正则手解三个数字 + 四个范围检查 + `new Date(y, mo-1, d, h, mi)`。
 */

/**
 * 待办标题上限 200 —— **镜像** `src/lib/constants.ts:25` 的 `TODO_TITLE_MAX_CHARS`。
 *
 * L9（`scripts/check-layers.mjs`）禁止分析窗 import 主窗 `src/lib/**`，所以只能镜像；
 * 改一处必须两处同改，`todoDraft.mirror.test.ts` 读两侧源码比对字面量把这条钉住
 * （否则症状是静默的：`maxLength` 一边 200 一边 200，后端却拒了）。后端同值校验在
 * `src-tauri/src/commands/todo_cmd.rs` 的 1-200。
 */
export const TODO_TITLE_MAX_CHARS = 200;

/** 校验结果。顺序即优先级：名称 → 时间格式 → 时间过期。 */
export type TodoDraftIssue = "emptyName" | "nameTooLong" | "timeInvalid" | "timePast";

/** 弹层里那三个输入的原样值（**没** trim、**没**解析） */
export interface TodoDraftInput {
  title: string;
  /** `datetime-local` 的原始字符串；空串 = 不排期 */
  timeLocal: string;
  /** 「提醒我」勾选状态；true 且有时间 → `remindAt` 与 `plannedAt` 同值 */
  remind: boolean;
}

/** 落库载荷：口径见 `planTodoWrite` */
export interface TodoWritePlan {
  title: string;
  plannedAt: number | null;
  remindAt: number | null;
}

/** `YYYY-MM-DDTHH:mm`（datetime-local 的 value 格式，分钟精度） */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 该年该月的天数（`new Date(y, m, 0)` = 上个月的最后一天；只做日期算术，不碰时分） */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * 毫秒 → 本地 `YYYY-MM-DDTHH:mm`（给 `datetime-local` 的 `value`）。
 *
 * 非法/非有限数返回空串（弹层据此显示为空 = 不排期），不抛错：这个函数的调用点
 * 都在渲染路径上，抛错会整块白屏。
 */
export function formatDateTimeLocal(ms: number): string {
  const at = new Date(ms);
  if (!Number.isFinite(at.getTime())) return "";
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
    + `T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * 本地 `YYYY-MM-DDTHH:mm` → 毫秒。空串 / 脏串 / 越界一律 `null`（**不抛错**）。
 *
 * 越界口径：月 1-12、日 1-当月天数（`2026-02-30` 也拒，别依赖 `Date` 的自动进位）、
 * 时 0-23、分 0-59。分钟精度之外的秒/毫秒恒为 0。
 */
export function parseDateTimeLocal(value: string): number | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);


  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23) return null;
  if (minute > 59) return null;

  const ms = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 提交前校验：返回第一个问题（`null` = 通过）。
 *
 *   · `emptyName`   = trim 后为空；
 *   · `nameTooLong` = trim 后长度 > 200；
 *   · `timeInvalid` = `timeLocal` **非空**但解析失败；
 *   · `timePast`    = **勾了提醒**且时刻 ≤ `nowMs`。
 *
 * `timePast` 为什么只在"勾了提醒"时才拦：宿主 `jobs::nudge_due` 有过期 grace 窗口，
 * 到点之后再勾提醒不会补弹 —— 等于静默失效，所以必须挡在提交前。不勾提醒时**允许
 * 过去时间**：补记「昨天该做没做」是合法用法，行上会自然显示红胶囊（`data-state="overdue"`）。
 *
 * "勾了提醒但时间为空"不在这里拦：弹层的时间为空时提醒勾选是 `disabled` 的，
 * 且清空时间会把勾选一起清掉（`TodoComposeDialog`），到不了这一层。
 * `planTodoWrite` 对这种情况也是安全的（两个字段都落 null）。
 */
export function validateTodoDraft(input: {
  title: string;
  timeLocal: string;
  remind: boolean;
  nowMs: number;
}): TodoDraftIssue | null {
  const title = input.title.trim();
  if (title === "") return "emptyName";
  if (title.length > TODO_TITLE_MAX_CHARS) return "nameTooLong";

  const timeLocal = input.timeLocal.trim();
  if (timeLocal === "") return null;

  const plannedAt = parseDateTimeLocal(timeLocal);
  if (plannedAt === null) return "timeInvalid";
  if (input.remind && plannedAt <= input.nowMs) return "timePast";
  return null;
}

/**
 * 时间口径的**唯一实现**：一个时间落两个字段。
 *
 *   `plannedAt` = 解析值（空 = null）
 *   `remindAt`  = 勾了提醒 ? **同一个值** : null
 *
 * 别在组件里再写一遍 `remind ? plannedAt : null` —— 单测直接钉这个函数，
 * 两处实现就会有两处漂移。
 */
export function planTodoWrite(input: TodoDraftInput): TodoWritePlan {
  const timeLocal = input.timeLocal.trim();
  const plannedAt = timeLocal === "" ? null : parseDateTimeLocal(timeLocal);
  const remindAt = input.remind && plannedAt !== null ? plannedAt : null;
  return { title: input.title.trim(), plannedAt, remindAt };
}

/** 毫秒 → 本地 `HH:mm`（行上铃铛的 `aria-label` 用；与胶囊同一套 24 小时制） */
export function reminderClock(ms: number): string {
  const at = new Date(ms);
  if (!Number.isFinite(at.getTime())) return "";
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}
