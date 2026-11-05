/**
 * Timing — 常用事项（置顶）与「默认倒计时」的纯函数层（V0.3.9）
 * -----------------------------------------------------------------------------
 * 常用事项 = `items.is_pinned` 的那批事项，顺序沿用后端 `sort_order`；
 * 每条可另存一个**默认倒计时时长**（分钟），存在 `settings.itemsTimers`（itemId → 分钟）。
 * 有值 → 点它起倒计时；无值 → 正计时。
 *
 * 为什么时长不落 items 表：它只是「这个事项点下去多长」的 UI 偏好，与 is_pinned /
 * sort_order 同层级；落 KV 就不用动表结构与 IPC 契约（与摸鱼预设同一思路）。
 */

/** 默认倒计时下限（分钟），与 Rust `ITEM_TIMER_MIN_MINUTES` 同值 */
export const ITEM_TIMER_MIN_MINUTES = 1;
/** 默认倒计时上限（分钟）= 24h，与 Rust `ITEM_TIMER_MAX_MINUTES` / MAX_COUNTDOWN_SEC 对齐 */
export const ITEM_TIMER_MAX_MINUTES = 1440;

export type ItemTimers = Record<string, number>;

/** 归一化：丢弃非法 id（<=0 / 非数字键）与超出 1..1440 的时长，其余取整。 */
export function normalizeItemTimers(raw: ItemTimers | null | undefined): ItemTimers {
  const out: ItemTimers = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isFinite(value)) continue;
    const minutes = Math.round(value);
    if (minutes < ITEM_TIMER_MIN_MINUTES || minutes > ITEM_TIMER_MAX_MINUTES) continue;
    out[String(id)] = minutes;
  }
  return out;
}

/** 取某事项的默认时长（分钟）；未设置返回 null。 */
export function itemTimerMinutes(timers: ItemTimers, itemId: number): number | null {
  const value = timers[String(itemId)];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 写入 / 清除某事项的默认时长（分钟传 null = 改回正计时）。 */
export function withItemTimer(
  timers: ItemTimers,
  itemId: number,
  minutes: number | null,
): ItemTimers {
  const next = { ...timers };
  if (minutes == null) delete next[String(itemId)];
  else next[String(itemId)] = minutes;
  return normalizeItemTimers(next);
}

/** 把 `from` 位置的元素挪到 `to`（越界原样返回新数组）。排序落库前用它算新顺序。 */
export function movedList<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
