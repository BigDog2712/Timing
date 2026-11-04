/**
 * TickBar — 待办时间选择器的日期 / 时间计算（唯一出口，纯函数）
 * -----------------------------------------------------------------------------
 * 用户口径（V0.3.9）：
 *   - 「新建待办事项时，时间默认在今天」；
 *   - 「点击日历后，下边额外显示一个『x 天后』」；
 *   - 「可切换上午 / 下午，分钟每五分钟为一间隔」。
 *
 * 约束：本文件只做计算，不碰 DOM / 不读 store；所有「日历日」都按**本地时区**取年月日
 * 再折成 UTC 序号相减（直接除 86400000 会在夏令时切换日错一天）。
 * 组件需要展示 / 换算时间，一律经本文件，禁止就地拼字符串（与 format.ts 同一条纪律）。
 */

/** 分钟档位间隔（用户口径：每 5 分钟一档） */
export const MINUTE_STEP = 5;

/** 分钟档位：0, 5, 10, …, 55 */
export const MINUTE_SLOTS: readonly number[] = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, i) => i * MINUTE_STEP,
);

/** 12 小时制的小时档位：1..12 */
export const HOUR12_SLOTS: readonly number[] = Array.from({ length: 12 }, (_, i) => i + 1);

/** 日历表头（周一起首，中文习惯） */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

export type Meridiem = 'am' | 'pm';

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/* ------------------------------ 日界线 ------------------------------ */

/** 本地日历日序号（去掉时分秒，避免 DST 下按毫秒除出错） */
function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** `to` 相对 `from` 差几个日历日（正数 = 未来，0 = 同一天） */
export function dayDiff(fromMs: number, toMs: number): number {
  return dayIndex(toMs) - dayIndex(fromMs);
}

/** 是否同一个日历日 */
export function isSameDay(a: number, b: number): boolean {
  return dayIndex(a) === dayIndex(b);
}

/**
 * 「今天 / N 天后 / N 天前」——用户口径要的就是这句「x 天后」，
 * 所以未来一律给「N 天后」（含 1 天），只有当天例外说「今天」。
 */
export function relativeDayLabel(ms: number, now: number): string {
  const diff = dayDiff(now, ms);
  if (diff === 0) return '今天';
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
}

/**
 * 字段里的读数：`今天 21:30` / `明天 09:00` / `10月24日 21:30` / 跨年 `2027年1月3日 09:00`。
 * 时刻固定 24 小时制 —— 与「今日计时」行（`formatClockTime`）同一口径，
 * 上午 / 下午只出现在选择器里（选择习惯），读数不因此变味。
 */
export function formatFieldLabel(ms: number | null, now: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const diff = dayDiff(now, ms);
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `明天 ${time}`;
  if (diff === -1) return `昨天 ${time}`;
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

/* ------------------------------ 12 小时制 ------------------------------ */

export interface Split12h {
  meridiem: Meridiem;
  hour12: number;
}

/** 24 小时制小时 → 上午 / 下午 + 12 小时制小时（0 点与 12 点都是 12） */
export function to12h(hour24: number): Split12h {
  if (hour24 === 0) return { meridiem: 'am', hour12: 12 };
  if (hour24 < 12) return { meridiem: 'am', hour12: hour24 };
  if (hour24 === 12) return { meridiem: 'pm', hour12: 12 };
  return { meridiem: 'pm', hour12: hour24 - 12 };
}

/** 上午 / 下午 + 12 小时制小时 → 24 小时制小时（12 上午 = 0 点，12 下午 = 12 点） */
export function to24h(meridiem: Meridiem, hour12: number): number {
  const base = hour12 % 12;
  return meridiem === 'pm' ? base + 12 : base;
}

/* ------------------------------ 组合 / 对齐 ------------------------------ */

/** 把「时:分」套到 `ms` 所在的那一天上 */
export function withTimeOfDay(ms: number, hour: number, minute: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime();
}

/**
 * 向上取到下一个分钟档（秒归零）。
 * 用途：打开选择器且还没设值时，默认给「今天 · 下一个 5 分钟整」——
 * 用户口径「时间默认在今天」，且不会给一个已经过去的整点。
 */
export function ceilToStep(ms: number, step: number = MINUTE_STEP): number {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  const rounded = Math.ceil(d.getMinutes() / step) * step;
  if (rounded >= 60) {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  } else {
    d.setMinutes(rounded);
  }
  return d.getTime();
}

/** 打开选择器时的兜底值：今天 + 下一个 5 分钟档 */
export function defaultPickerValue(now: number): number {
  return ceilToStep(now);
}

/* ------------------------------ 月历网格 ------------------------------ */

export interface DayCell {
  /** 该格代表的那一天（本地 0 点） */
  ms: number;
  /** 日期数字 1..31 */
  date: number;
  /** 是否属于当前展示的月份（否则是补位的上 / 下月） */
  inMonth: boolean;
}

/**
 * 月历网格：周一起首，补齐前后整周（4~6 行）。
 * 只在需要「点选日期」的地方调用；不做「展示几个月」的事。
 */
export function monthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 周日 0 → 周一 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;
  const cells: DayCell[] = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(year, month, 1 - offset + i);
    cells.push({ ms: d.getTime(), date: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

/** 取某月的上 / 下个月（返回规范化后的 {year, month}，month 已跨年归位） */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
