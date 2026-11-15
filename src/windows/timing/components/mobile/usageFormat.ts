/**
 * [0.13.1] 统计页的显示口径（纯函数，单独一份）。
 *
 * 为什么从 `UsagePage.tsx` 抽出来：一个页面要同时给「趋势柱」和「排行行」用同一套格式化，
 * 而趋势柱是另一个组件 —— 组件之间互相 import 会绕成环。这一份只做字符串，不认识 React。
 *
 * 日期解析一律走 `lib/time.ts:parseDateInput`：它已经把 `new Date('2026-11-15')` 按 UTC
 * 解析那个坑挡掉了（东八区会落到前一天 08:00）。这里绝不自己再写一份正则。
 */
import { parseDateInput } from '../../lib/time';

/** 秒 → 「1h 05m」/「12m」：与 PC 版 `formatDashboardDuration` 同口径（分钟取整）。 */
export function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours}h ${String(rest).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/**
 * 包名 → 可读名（**兜底用**，不是首选）。
 *
 * 真正的应用名由系统给（Kotlin `AppMetadata` 走 `PackageManager.getApplicationLabel`，
 * 经 `usage_stats_get` 的 `label` 字段上来）。这里只在这种情况被用到：
 * 包已卸载（系统查不到）、或回值来自浏览器 mock。
 *
 * 取包名最后一段并首字母大写，至少比 `com.tencent.mm` 这种长串好认 ——
 * 但要知道它**是错的**：`com.tencent.mm` 不是「Mm」而是「微信」，
 * `tv.danmaku.bili` 不是「Bili」而是「哔哩哔哩」。0.13.2 之前整页都是这种名字。
 */
export function shortName(packageName: string): string {
  const tail = packageName.split('.').filter(Boolean).pop() ?? packageName;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * 一行 → 界面上显示的名字。**全页只有这一条规则**：真名优先，空则回落包名短名。
 *
 * 为什么单拎出来：列表、洞察句、详情标题三处都要名字。各自写一遍 `label || shortName(...)`
 * 迟早有一处写成 `label || packageName`（那就是 `com.tencent.mm` 直接露在标题上），
 * 或者有一处忘了回落（空名字 = 一整行只剩时长）。判据钉在这里。
 */
export function displayName(row: { packageName: string; label?: string }): string {
  const label = (row.label ?? '').trim();
  return label === '' ? shortName(row.packageName) : label;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 「周六」。非法键回空串 —— 不编一个假的星期去占位。 */
export function weekdayShort(key: string): string {
  const start = parseDateInput(key);
  return start == null ? '' : WEEKDAYS[new Date(start).getDay()];
}

/**
 * 「11/15」——与主界面品牌区同口径。
 * 不写「11月15日」：375px 屏的日期条还要塞两个箭头，四个汉字加空格会把它挤到换行。
 */
export function monthDayShort(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  return m == null ? key : `${Number(m[2])}/${Number(m[3])}`;
}

/**
 * 毫秒时刻 → 「08:12」（本机时区）。
 *
 * **不要用 `toISOString().slice(11,16)`**：那是 UTC，东八区会整整早 8 小时
 * （「早上 8 点开始用手机」被显示成「00:12」），而且不报错。`getHours()` 才是本机时区。
 * `0` 是「不知道」（后端没采到），回 `—` 而不是 `00:00`。
 */
export function clockText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 秒 → 「43 分钟」/「1 小时 05 分」——**句子里的**时长。
 *
 * 与 `formatDuration`（「1h 05m」，读数用）分开：洞察文案是给人读的句子，
 * 「比昨天多用 1h 05m」中英混排很别扭。
 */
export function formatSpanCN(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  if (safe < 60) return '不到 1 分钟';
  const minutes = Math.round(safe / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 「11/15 周六」——趋势柱与日期条共用的完整短标签。 */
export function monthDayText(key: string): string {
  const day = monthDayShort(key);
  const week = weekdayShort(key);
  return week === '' ? day : `${day} ${week}`;
}
