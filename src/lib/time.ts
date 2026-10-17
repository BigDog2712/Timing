/**
 * TickBar — 时间区间助手（记录面板「今天 / 本周」用）
 * -----------------------------------------------------------------------------
 * 契约：list_records / stats_summary 的 `from` 含、`to` 不含，作用字段 started_at。
 * 跨零点会话归属到**开始日期**（按 started_at 过滤天然满足）。
 */

/** 今天 00:00:00.000 的 epoch 毫秒（本地时区） */
export function startOfDay(reference: number = Date.now()): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 本周一 00:00:00.000 的 epoch 毫秒（本地时区，周一为一周起点） */
export function startOfWeek(reference: number = Date.now()): number {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  const isoDow = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  d.setDate(d.getDate() - isoDow);
  return d.getTime();
}

/** 记录面板范围类型 */
export type RecordsRange = 'day' | 'week';

/** 依范围返回 `{ from, to }`；`to` 缺省（含至当前） */
export function rangeBounds(range: RecordsRange): { from: number; to: number } {
  if (range === 'day') {
    const from = startOfDay();
    const end = new Date(from);
    end.setDate(end.getDate() + 1);
    return { from, to: end.getTime() };
  }
  const from = startOfWeek();
  const end = new Date(from);
  end.setDate(end.getDate() + 7);
  return { from, to: end.getTime() };
}
