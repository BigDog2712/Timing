/**
 * Timing — 待办行右侧时间列文案（ADR-034）
 * -----------------------------------------------------------------------------
 * 用户口径（原话 + 追问确认）：「在事项组件右键唤起的事项菜单，待办事项区应保存为规定时间
 * 及规定在以后完成的待办事项」；「右侧显示逾期；对于未来的任务，显示日期」。
 *
 * 面板自 ADR-034 起显示**全部未完成**待办（今天 / 未来 / 已逾期 / 未排期都在），
 * 一格只写 `HH:MM` 会让「明天 09:00」和「今天 09:00」长得一模一样 —— 所以文案按
 * **与今天的关系**分级：
 *
 * | 情形 | 文案 | title（hover） |
 * |---|---|---|
 * | 两项时间都没设 | 空（留白，ADR-028 §7） | 无 |
 * | 未完成 + `planned_at < now`（逾期） | `逾期` | 逾期基准 `planned_at` 的完整时间 |
 * | 目标时刻不在今天 | `MM-DD`（跨年 `YY-MM-DD`） | 目标时刻的完整时间 |
 * | 目标时刻在今天 | `HH:MM` | 同上 |
 * | 已完成 | 完成日 = 今天 → `HH:MM`；否则日期 | 同上 |
 *
 * 取值口径（ADR-028 §7，别改）：目标时刻 = `remindAt ?? plannedAt`（有开始时间按开始）。
 * 逾期只看 `plannedAt < now`：`remindAt` 是开始 / 提醒时刻，过了不代表没兑现截止承诺。
 * 这条判据与 `TodosPendingRow.pendingTone` 共用本文件的 `isTodoOverdue`，两处各写一遍
 * 必然漂移（「文案说逾期、行不淡化」或反之）。
 *
 * 跨年写成 `27-01-05`：面板里只写 `01-05` 的话，读者分不清是今年 1 月 5 日还是明年。
 * 纯函数、不碰 DOM / store，所以文案规则可以在单测里钉死（`todoTimeLabel.test.ts`）。
 */
import { isSameDay } from './datetime';
import { formatClockTime } from './format';
import type { Todo } from '../types/domain';

/** 时间列要显示什么：`text` 进格子，`title` 进 `title` 属性（完整时间，hover 可查） */
export interface TodoTimeLabel {
  text: string;
  title: string | null;
}

/** 逾期：未完成 + 有截止时间 + 截止已过（`remind_at` 不参与，见文件头） */
export function isTodoOverdue(
  todo: Pick<Todo, 'doneAt' | 'plannedAt'>,
  now: number,
): boolean {
  return todo.doneAt == null && todo.plannedAt != null && todo.plannedAt < now;
}

/** 两位补零 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 完整时刻 `YYYY-MM-DD HH:MM`（本地时区；hover 兜住被缩写掉的信息） */
function fullStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * 日期缩写：同年 `MM-DD`，跨年 `YY-MM-DD`。
 * 「哪一年」以 `now` 为准（不是以目标自身），跨年那几个月才不会两种写法混排。
 */
function dateStamp(ms: number, now: number): string {
  const d = new Date(ms);
  const monthDay = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return monthDay;
  return `${String(d.getFullYear()).slice(-2)}-${monthDay}`;
}

/**
 * 时间列文案（详见文件头那张表）。
 *
 * `now` 必须由调用方传（面板每分钟刷一次），本函数不读时钟 —— 否则同一行在两次渲染里
 * 可能算出不同文案，测试也无法固定时间。
 */
export function todoTimeLabel(
  todo: Pick<Todo, 'remindAt' | 'plannedAt' | 'doneAt'>,
  now: number,
): TodoTimeLabel {
  const target = todo.remindAt ?? todo.plannedAt;
  if (target == null || !Number.isFinite(target)) return { text: '', title: null };

  if (isTodoOverdue(todo, now)) {
    /* 逾期时格子写「逾期」，hover 给出**逾期基准**（planned_at）而不是目标时刻：
       只设了开始时间且开始时间未到、截止却已过的行，hover 到开始时间会答非所问。 */
    const basis = todo.plannedAt ?? target;
    return { text: '逾期', title: fullStamp(basis) };
  }

  /* 粒度看「哪一天」：未完成行比今天，已完成行比**完成日**（面板里已完成只留今天完成的，
     非今天完成的分支是防御性的，见 ADR-034）。 */
  const anchor = todo.doneAt ?? now;
  const text = isSameDay(target, anchor) ? formatClockTime(target) : dateStamp(target, now);
  return { text, title: fullStamp(target) };
}
