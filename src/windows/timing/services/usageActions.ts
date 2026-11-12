/**
 * [0.13.0] 应用使用统计的动作层（手机「统计」页的唯一入口）。
 *
 * 为什么必须有这一层：L1 门禁禁止 `src/components/**` 出现 `ipc.` —— 组件只能通过动作层
 * 说话。这不是形式：手机页面同时被桌面外壳与浏览器 mock 复用，直连 ipc 会让「桌面点进来」
 * 和「浏览器走查」两条路各有一套错误处理。
 */
import { ipc } from './ipc';
import type { UsageDayDto } from '../types/domain/usage';

/** 今天（本地日 yyyy-MM-dd）。与 PC 版 `formatLocalDateKey` 同口径。 */
export function todayKey(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 取某天（默认今天）的应用使用排行。未授权时抛 `USAGE_PERMISSION_DENIED`。 */
export function loadUsageDay(date: string = todayKey()): Promise<UsageDayDto> {
  return ipc.usageStatsGet(date);
}

/** 跳系统「使用情况访问」页。 */
export function openUsageSettings(): Promise<void> {
  return ipc.usageStatsSettings();
}
