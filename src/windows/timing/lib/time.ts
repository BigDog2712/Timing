/**
 * Timing — 时间区间助手（记录面板「今天 / 本周 / 近七天 / 本月 / 往日」用）
 * -----------------------------------------------------------------------------
 * 契约：list_records / stats_summary 的 `from` 含、`to` 不含，作用字段 started_at。
 * 跨零点会话归属到**开始日期**（按 started_at 过滤天然满足）。
 *
 * [V0.11.31] 主人原话「那把本周改为往期，可选择本周、近七天、本月、往日等」——
 * 原来是「今天 / 本周」两档写死在 `RecordsRange` 里，「往期」在手机上根本点不到。
 * 现在五档全部由本文件算区间，页面只管选档位：
 *
 * | 档位 | from | to |
 * |---|---|---|
 * | `day`   | 今天 00:00 | 明天 00:00 |
 * | `week`  | 本周一 00:00 | 下周一 00:00 |
 * | `last7` | 六天前 00:00 | 明天 00:00（含今天共 7 个自然日）|
 * | `month` | 本月 1 日 00:00 | 下月 1 日 00:00 |
 * | `date`  | reference 那天 00:00 | 次日 00:00（往日，用户自己挑）|
 *
 * 所有档位都用**本地时区**算，且一律走 `setDate/getDate`（而不是加减 86400000），
 * 这样夏令时、跨月、闰日由 Date 自己处理，不用我们记住哪个月有几天。
 */

/** 某天 00:00:00.000 的 epoch 毫秒（本地时区） */
export function startOfDay(reference: number = Date.now()): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 本周一 00:00:00.000（本地时区，周一为一周起点） */
export function startOfWeek(reference: number = Date.now()): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  const isoDow = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  d.setDate(d.getDate() - isoDow);
  return d.getTime();
}

/** 本月 1 日 00:00:00.000（本地时区） */
export function startOfMonth(reference: number = Date.now()): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

/** 在某个时刻上加 / 减若干**自然日**（跨月、闰日、夏令时由 Date 处理） */
function addDays(reference: number, days: number): number {
  const d = new Date(reference);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 记录面板范围类型 */
export type RecordsRange = 'day' | 'week' | 'last7' | 'month' | 'date';

/**
 * 依范围返回 `{ from, to }`（from 含、to 不含）。
 *
 * `reference` 只对 `day` / `date` 有意义（`day` 缺省就是「此刻所在那天」）；
 * 其余档位一律以它所在的那一周 / 月为基准 —— 同一套参数能让「往日」指向任意一天，
 * 也让判据可以把 `reference` 钉在周一、月末这些边界上跑。
 */
export function rangeBounds(
  range: RecordsRange,
  reference: number = Date.now(),
): { from: number; to: number } {
  switch (range) {
    case 'day':
    case 'date': {
      const from = startOfDay(reference);
      return { from, to: addDays(from, 1) };
    }
    case 'week': {
      const from = startOfWeek(reference);
      return { from, to: addDays(from, 7) };
    }
    case 'last7': {
      const from = addDays(startOfDay(reference), -6);
      return { from, to: addDays(startOfDay(reference), 1) };
    }
    case 'month': {
      const from = startOfMonth(reference);
      const d = new Date(from);
      d.setMonth(d.getMonth() + 1); // 下月 1 日（12 月自动进位到次年 1 月）
      return { from, to: d.getTime() };
    }
  }
}

/**
 * 档位在界面上的说法（记录页明细副标题、底部说明、空态都读这一句）。
 *
 * 「往日」要把用户挑的那天写出来——只写「往日」等于没说清看的是哪一天，
 * 而记录页最怕的就是「数字对不上我还不知道为什么」。
 */
export function rangeLabel(range: RecordsRange, reference: number = Date.now()): string {
  switch (range) {
    case 'day':
      return '今天';
    case 'week':
      return '本周';
    case 'last7':
      return '近七天';
    case 'month':
      return '本月';
    case 'date': {
      const d = new Date(reference);
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    }
  }
}

/** 底部那句口径说明（与 `rangeLabel` 分开：标签要短，说明要能打消疑问） */
export function rangeHint(range: RecordsRange): string {
  switch (range) {
    case 'day':
      return '今天 00:00 起 24 小时';
    case 'week':
      return '本周从周一 00:00 起 7 天（周一是第一天）';
    case 'last7':
      return '含今天在内的 7 个自然日（不是「最近 168 小时」）';
    case 'month':
      return '本月 1 日 00:00 起到今天';
    case 'date':
      return '按那一天 00:00 起的 24 小时';
  }
}

/** `<input type="date">` 需要的 `YYYY-MM-DD`（本地时区，不能用 toISOString，那是 UTC） */
export function dateInputValue(reference: number): string {
  const d = new Date(reference);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * `YYYY-MM-DD` → 那天 00:00 的本地 epoch 毫秒。
 *
 * 不用 `new Date('2026-11-09')`：那种写法按 **UTC** 解析，东八区会得到昨天 08:00。
 * 拆成数字再 `new Date(y, m, d)` 才是本地零点。
 */
export function parseDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  /* 反查一遍：2026-02-30 会被 Date 顺延成 3 月 2 日，那不是用户选的日子*/
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

/** 拼「日期 + 时刻」两个原生控件 → epoch 毫秒；任一非法返回 null */
export function parseDateTimeInput(dateValue: string, timeValue: string): number | null {
  const day = parseDateInput(dateValue);
  if (day == null) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** epoch 毫秒 → `<input type="time">` 需要的 `HH:mm`（本地时区） */
export function timeInputValue(reference: number): string {
  const d = new Date(reference);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
