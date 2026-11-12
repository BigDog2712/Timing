/**
 * Timing — 宿主侧「今天」的日期口径（P0-03，唯一）
 * -----------------------------------------------------------------------------
 * 为什么单开一份而不是 import 分析窗的 `formatLocalDateKey`：
 *   L9（`scripts/check-layers.mjs`）禁止主窗（`src/lib`…）与分析窗（`src/shared`…）
 *   互相 import，`import type` 也算。所以 `src/shared/lib/localDate.ts:24-26` 的那份
 *   实现必须在这里**再写一遍**，两份的语义必须逐字一致（同一个本地日 → 同一个
 *   `YYYY-MM-DD`）。改口径时两侧同批改。
 *
 * 为什么不能用 `toISOString().slice(0, 10)`：
 *   它按 **UTC** 截断。东八区的本地 00:30 是 UTC 前一天 16:30，直接取就会得到
 *   「昨天」，跨时区的用户每天有 8 小时点「今天」都落到前一天。所以只用
 *   `getFullYear / getMonth / getDate`（本地时区）。
 */

/** 两位补零（`0` → `"00"`）。 */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地日历日 → `YYYY-MM-DD`（补零，无时区后缀）。 */
export function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 「今天」的 dateKey。默认取当前时刻；`now` 只在测试里注入。
 * 注意：与 `formatLocalDateKey` 是同一口径，`todayDateKey()` 只是「不给参数的便捷名」。
 */
export function todayDateKey(now: Date = new Date()): string {
  return formatLocalDateKey(now);
}
