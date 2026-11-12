/**
 * 今日时间线卡「事项管理」的**纯函数层**（[本轮]）。
 *
 * 用户的原始诉求是「直接调用原功能」——悬浮窗事项菜单（`src/components/menu/ItemsPrefsMenu.tsx`）
 * 的那一套：常用事项分组、默认倒计时时长、上移下移、近期事项条数。但分析窗**读不到**主窗：
 * `scripts/check-layers.mjs` 的 L9 硬约束禁止 `src/features/**` import `src/lib/**`。
 * 所以这里的落地方式是 **镜像一份等价纯函数**，并靠下面这两个 source test 钉住常量同值：
 *   · `itemPrefs.test.ts` —— 行为（钳制 / 三态 / 排序 / 越界）
 *   · `itemPrefs.mirror.test.ts` —— 与 `src/lib/commonItems.ts` / `src/lib/moyu.ts` 的数值一致
 *
 * ⚠️ **改一处必须两处同改**：`ITEM_TIMER_MIN_MINUTES` / `ITEM_TIMER_MAX_MINUTES` 与
 * `src/lib/commonItems.ts` 同值，`RECENT_ITEMS_MIN/MAX/DEFAULT` 与 `src/lib/moyu.ts` 同值。
 * 漂了不会报错，只会让「宿主里显示 1440、卡里显示 1」这种静默不一致发生 —— 所以镜像测试是必需的。
 *
 * 时长为什么不落 items 表：它只是「这个事项点下去多长」的 UI 偏好，宿主侧也存在
 * `settings.itemsTimers`（itemId → 分钟），与 `is_pinned` / `sort_order` 同层级。
 */

/** 默认倒计时下限（分钟），与 `src/lib/commonItems.ts` 同值 */
export const ITEM_TIMER_MIN_MINUTES = 1;
/** 默认倒计时上限（分钟）= 24h，与 `src/lib/commonItems.ts` 同值 */
export const ITEM_TIMER_MAX_MINUTES = 1440;
/** 最近事项条数下限，与 `src/lib/moyu.ts::RECENT_ITEMS_MIN` 同值 */
export const RECENT_ITEMS_MIN = 1;
/** 最近事项条数上限，与 `src/lib/moyu.ts::RECENT_ITEMS_MAX` 同值 */
export const RECENT_ITEMS_MAX = 10;
/** 最近事项条数默认值，与 `src/lib/moyu.ts::RECENT_ITEMS_DEFAULT` 同值 */
export const RECENT_ITEMS_DEFAULT = 5;

/** 事项 id（字符串键）→ 默认时长（分钟） */
export type ItemTimers = Record<string, number>;

/**
 * 纯函数所需的**最小字段集**（结构类型）。
 *
 * 用结构类型而不是 import `TimingItem`：`listTimingItems()` 的返回值天然满足它（多出来的
 * `name` / `color` 等字段不影响），而单测里造夹具不用凑齐十个字段。
 */
export interface ItemPrefsLike {
  id: number;
  name: string;
  isSystem: boolean;
  isPinned: boolean;
  sortOrder: number;
  updatedAt: number;
}

/**
 * 归一化：丢弃非法 id（<=0 / 非整数键）与超出 1..1440 的时长，其余取整。
 * 宿主返回的 KV 里可能残留旧版本写坏的值，脏值一律**丢弃**而不是钳制——
 * 钳制会把「25 分钟」这种脏值洗成看起来正常的「1 分钟」，用户更难发现。
 */
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

/** 取某事项的默认时长（分钟）；未设置返回 `null`（= 正计时）。 */
export function itemTimerMinutes(timers: ItemTimers, itemId: number): number | null {
  const value = timers[String(itemId)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 写入 / 清除某事项的默认时长（**三态**，与意图协议的 `timerMinutes` 一一对应）：
 *   · 数字 → 设为该分钟数（顺手归一化）
 *   · `null` → 删除这个键 = 回到正计时
 *   · 不调用 → 不改（调用方负责“没改动就别发意图”）
 */
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

/** 数字钳制到 [1, 1440] 的整数；非有限数 → `null`（调用方当成“没填”）。 */
function clampMinutesNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(ITEM_TIMER_MAX_MINUTES, Math.max(ITEM_TIMER_MIN_MINUTES, Math.round(value)));
}

/**
 * 表单输入 → 合法分钟数。
 *
 * 口径与宿主 `ItemsPrefsMenu.readMinutes()` 一致：**留空 = 正计时（`null`）**，超界**钳制**
 * （用户填 2000 想说的是“很长”，钳到 24h 比报错好）；非数字输入（`abc` / `NaN`）→ `null`，
 * 界面上那一层会另给一句提示（`timelineTimerInvalid`），纯函数不承担文案。
 */
export function clampItemMinutes(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return clampMinutesNumber(raw);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return null;
    return clampMinutesNumber(Number(text));
  }
  return null;
}

/** 最近事项条数钳制到 1..10（非有限数回落默认 5），与 `src/lib/moyu.ts::clampRecentCount` 同口径。 */
export function clampRecentCount(value: number): number {
  if (!Number.isFinite(value)) return RECENT_ITEMS_DEFAULT;
  return Math.min(RECENT_ITEMS_MAX, Math.max(RECENT_ITEMS_MIN, Math.round(value)));
}

/**
 * 常用事项：`isPinned && !isSystem`，按 `sortOrder ASC, id ASC`。
 *
 * 系统事项（`未归类`）即便被置顶也不列：改名/移出常用都会破坏它的语义，
 * 而 Rust 的 `item_system_protected` 只保护 archive/delete —— 只能在这一层挡。
 */
export function pinnedItems<T extends ItemPrefsLike>(items: readonly T[]): T[] {
  return items
    .filter((item) => item.isPinned && !item.isSystem)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/**
 * 近期事项：非置顶、非系统项，按 `updatedAt` **倒序**取前 N 条。
 *
 * 排除置顶项：它们已经在上一组出现，重复展示只会挤掉别的候选（与宿主
 * `recentItems` 同口径）。N 先过 `clampRecentCount`，脏设置值不会把列表撑爆。
 */
export function recentItems<T extends ItemPrefsLike>(items: readonly T[], count: number): T[] {
  const limit = clampRecentCount(count);
  return items
    .filter((item) => !item.isSystem && !item.isPinned)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * 把 `from` 位置的元素挪到 `to`（越界 / 同一个位置 → 原样返回新数组）。
 * 与 `src/lib/commonItems.ts::movedList` 同一套边界口径；上移下移按钮用它算目标位置。
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 新增一条常用事项时该用的 `sortOrder` = 现有**常用**事项里最大的那个 + 1。
 * 与宿主 `ItemsPrefsMenu` 的 `nextOrder` 同算法（空的常用组 → 1）。
 */
export function nextSortOrder(items: readonly ItemPrefsLike[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
}
