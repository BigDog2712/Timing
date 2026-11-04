/**
 * TickBar — 手打时间解析（V0.3.13 / ADR-031）
 * -----------------------------------------------------------------------------
 * 用户口径：「点开编辑事项后…点击某一事项的开始时间，输入新的时间即可」——
 * 时间不再点开日历浮层选，而是**直接打字**。这里只做「字符串 → epoch ms」这一件事，
 * 不碰 DOM、不碰业务校验（截止 ≥ 开启那些仍在 `lib/todoTimes.ts`）。
 *
 * 接受的写法（大小写 / 全角冒号 / 全角数字都先归一）：
 *   `09:00`           今天 09:00
 *   `21:30`           同上（24 小时制；写 `9:05` 也行）
 *   `明天 09:00`       支持 今天 / 今日 / 明天 / 明日 / 后天
 *   `10-21 09:00`     月-日（当年；`10/21` 同义）
 *   `2026-10-21 09:00` 带年份
 * 语义边界：**只给时刻时按「今天」算**，不自动翻到明天 —— 面板本来就是「今日」的时间线，
 * 用户看到的 09:00 就该是今天的 09:00。
 */

/** 解析结果（ok=false 时带一句可直接显示的中文提示） */
export type TimeParseResult = { ok: true; ms: number } | { ok: false; error: string };

const FULLWIDTH_DIGITS = '０１２３４５６７８９';

/** 全角数字 / 冒号 / 日期分隔符归一，顺手去掉多余空白 */
function normalize(raw: string): string {
  let out = '';
  for (const ch of raw.trim()) {
    const digit = FULLWIDTH_DIGITS.indexOf(ch);
    if (digit >= 0) out += String(digit);
    else if (ch === '：') out += ':';
    else if (ch === '／') out += '/';
    else if (ch === '－' || ch === '—') out += '-';
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function startOfDay(base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 解析一句手打的时间。
 * @param raw 用户输入
 * @param now 当前时刻（epoch ms；测试注入）
 */
export function parseTimeInput(raw: string, now: number): TimeParseResult {
  const text = normalize(raw);
  if (!text) return { ok: false, error: '时间不能为空' };

  let rest = text;
  let dayOffset: number | null = null;
  const relative = /^(今天|今日|明天|明日|后天)\s*/.exec(rest);
  if (relative) {
    const word = relative[1];
    dayOffset = word === '后天' ? 2 : word === '明天' || word === '明日' ? 1 : 0;
    rest = rest.slice(relative[0].length).trim();
  }

  /* 日期部分：`YYYY-M-D` / `M-D` / `M/D`（后面必须跟空白再接时刻） */
  let datePart: { year: number | null; month: number; day: number } | null = null;
  const dated = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?:\s+(.*))?$/.exec(rest);
  let timeText = rest;
  if (dated) {
    const month = Number(dated[2]);
    const day = Number(dated[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { ok: false, error: '日期格式不对，试试「10-21 09:00」' };
    }
    datePart = { year: dated[1] ? Number(dated[1]) : null, month, day };
    timeText = (dated[4] ?? '').trim();
    if (!timeText) return { ok: false, error: '还差一个时刻，比如「10-21 09:00」' };
  }

  const clock = /^(\d{1,2}):(\d{2})$/.exec(timeText);
  if (!clock) return { ok: false, error: '时间格式不对，试试「09:00」或「明天 09:00」' };
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return { ok: false, error: '时间超出范围（00:00 – 23:59）' };

  const base = startOfDay(new Date(now));
  if (datePart) {
    const year = datePart.year ?? base.getFullYear();
    const withDate = new Date(year, datePart.month - 1, datePart.day);
    // 2 月 31 日之类会被 Date 自动进位 —— 回读校验，避免「悄悄改日期」
    if (withDate.getMonth() !== datePart.month - 1 || withDate.getDate() !== datePart.day) {
      return { ok: false, error: '这个日期不存在' };
    }
    base.setFullYear(year, datePart.month - 1, datePart.day);
  }
  if (dayOffset != null) base.setDate(base.getDate() + dayOffset);
  base.setHours(hour, minute, 0, 0);
  return { ok: true, ms: base.getTime() };
}

/** 回填到输入框的文本：今天 → `HH:MM`；同年跨天 → `MM-DD HH:MM`；跨年 → `YYYY-MM-DD HH:MM`
 *  （三种都能被 `parseTimeInput` 原样读回来 —— 否则「明天」跨年时会悄悄丢一年） */
export function timeInputText(ms: number, now: number): string {
  const target = new Date(ms);
  const today = startOfDay(new Date(now));
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
  if (startOfDay(target).getTime() === today.getTime()) return clock;
  const md = `${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
  if (target.getFullYear() !== today.getFullYear()) return `${target.getFullYear()}-${md} ${clock}`;
  return `${md} ${clock}`;
}
