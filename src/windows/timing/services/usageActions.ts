/**
 * [0.13.0] 应用使用统计的动作层（手机「统计」页的唯一入口）。
 *
 * 为什么必须有这一层：L1 门禁禁止 `src/components/**` 出现 `ipc.` —— 组件只能通过动作层
 * 说话。这不是形式：手机页面同时被桌面外壳与浏览器 mock 复用，直连 ipc 会让「桌面点进来」
 * 和「浏览器走查」两条路各有一套错误处理。
 *
 * 这里只放「取数」与「日键算术」；把日键变成汉字的活归 `components/mobile/usageFormat.ts`。
 */
import { ipc } from './ipc';
import { parseDateInput } from '../lib/time';
import type { UsageDayDto } from '../types/domain/usage';

/** 近 7 天趋势的窗口长度：与安卓系统保留明细的天数（各 ROM 常见 7 天）对齐。 */
export const TREND_DAYS = 7;

/** 今天（本地日 yyyy-MM-dd）。与 PC 版 `formatLocalDateKey` 同口径。 */
export function todayKey(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 在日键上加减天数（负数为往前）。
 *
 * 走 `new Date(y, m-1, d + delta)` 让 Date 自己处理跨月、跨年、闰年；
 * **不要用 `+ delta * 86400000` 再取日期** —— 夏令时切换那天会落到 23:00 或 01:00，
 * 再格式化就整整错一天（记录页「往日」踩过同款）。
 *
 * 非法键**原样返回**：调用方拿到同一串，页面会显示「读不到这一天」，不会静默跳到今天。
 */
export function shiftDayKey(key: string, delta: number): string {
  const start = parseDateInput(key);
  if (start == null) return key;
  const d = new Date(start);
  return todayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta));
}

/** 近 `count` 天（含 `endKey`），**从旧到新** —— 趋势柱左旧右新，数组顺序就是绘制顺序。 */
export function recentDayKeys(endKey: string, count: number): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) out.push(shiftDayKey(endKey, -back));
  return out;
}

/** 取某天（默认今天）的应用使用排行。未授权时抛 `USAGE_PERMISSION_DENIED`。 */
export function loadUsageDay(date: string = todayKey()): Promise<UsageDayDto> {
  return ipc.usageStatsGet(date);
}

/** 跳系统「使用情况访问」页。 */
export function openUsageSettings(): Promise<void> {
  return ipc.usageStatsSettings();
}
