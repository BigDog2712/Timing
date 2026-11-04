/**
 * TickBar — 摸鱼菜单口径（纯函数，V0.3.2 / V0.3.9）
 * -----------------------------------------------------------------------------
 * 边界口径只写在这里：`MoyuCustom` 的滚轮步进、`moyuActions` 的兜底归一化、
 * 常用摸鱼的增删改排序、常用事项框的「置顶 / 最近编辑」筛选，全部调用本文件，
 * 不再各写一份 `Math.min/max` 或 `sort`。
 *
 * 上限 1440 分钟（24h）与后端 `MAX_COUNTDOWN_SEC` 对齐：越界会在 Rust 侧
 * 以 `INVALID_TARGET_SEC` 打回来，前端先夹紧能省一次失败往返。
 */
import type { Item, MoyuPreset } from '../types/domain';

/** 最短 1 分钟 */
export const MOYU_MIN_MINUTES = 1;
/** 最长 24 小时 */
export const MOYU_MAX_MINUTES = 1440;
/** 「其他事项」的初始时长 */
export const MOYU_DEFAULT_MINUTES = 10;
/** 常用摸鱼名称上限（与 `MoyuCustom` 输入框、后端校验同值） */
export const MOYU_NAME_MAX_LEN = 40;
/** 常用摸鱼条目上限（与 Rust `MOYU_PRESET_MAX` 同值） */
export const MOYU_PRESET_MAX = 20;

/** 最近编辑条数范围（与 Rust `RECENT_ITEMS_*` 同值） */
export const RECENT_ITEMS_MIN = 1;
export const RECENT_ITEMS_MAX = 10;
export const RECENT_ITEMS_DEFAULT = 5;

/** 出厂三条（与 Rust `models::moyu::default_presets()` 逐字同值） */
export const DEFAULT_MOYU_PRESETS: readonly MoyuPreset[] = [
  { id: 'factory-toilet', item: '上厕所', minutes: 10, mode: 'countdown' },
  { id: 'factory-moyu', item: '摸鱼', minutes: 25, mode: 'countdown' },
  { id: 'factory-meal', item: '吃饭', minutes: 60, mode: 'countdown' },
];

/**
 * 归一化到 [1, 1440] 的整数分钟。
 * 非有限数（NaN / Infinity / 来自空输入框的 undefined 强转）回落到默认 10 分钟——
 * 宁可给一个能用的值，也不要 0 分钟这种必然失败的目标。
 */
export function clampMoyuMinutes(value: number): number {
  if (!Number.isFinite(value)) return MOYU_DEFAULT_MINUTES;
  return Math.min(MOYU_MAX_MINUTES, Math.max(MOYU_MIN_MINUTES, Math.round(value)));
}

/** 最近编辑条数钳制到 1..10（非有限数回落默认 5） */
export function clampRecentCount(value: number): number {
  if (!Number.isFinite(value)) return RECENT_ITEMS_DEFAULT;
  return Math.min(RECENT_ITEMS_MAX, Math.max(RECENT_ITEMS_MIN, Math.round(value)));
}

/**
 * 整表归一（保存前）：丢空名、名字截断 40 字符、分钟钳制、id 补齐去重、条数封顶。
 * 与 Rust `normalize_presets` 同口径——前端先归一，后端再兜一次。
 */
export function normalizeMoyuPresets(list: readonly MoyuPreset[]): MoyuPreset[] {
  const out: MoyuPreset[] = [];
  for (const raw of list) {
    if (out.length >= MOYU_PRESET_MAX) break;
    const item = raw.item.trim().slice(0, MOYU_NAME_MAX_LEN);
    if (item.length === 0) continue;
    let id = raw.id.trim();
    if (id.length === 0 || out.some((p) => p.id === id)) {
      let n = out.length + 1;
      while (out.some((p) => p.id === `p${n}`)) n += 1;
      id = `p${n}`;
    }
    out.push({ id, item, minutes: clampMoyuMinutes(raw.minutes), mode: raw.mode });
  }
  return out;
}

/** 上移 / 下移一格（越界原样返回，调用方不必判边界） */
export function moveMoyuPreset(list: readonly MoyuPreset[], index: number, delta: number): MoyuPreset[] {
  const next = [...list];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

/** 置顶事项（后端已按 is_pinned DESC 排序，这里只筛不改序） */
export function pinnedItems(items: readonly Item[]): Item[] {
  return items.filter((item) => item.isPinned && !item.isSystem);
}

/**
 * 最近编辑：按 `updatedAt` 倒序取前 N 条，排除系统事项与已置顶项
 * （置顶已经在上一组出现，重复展示只会挤掉别的候选）。
 */
export function recentItems(items: readonly Item[], count: number): Item[] {
  const limit = clampRecentCount(count);
  return items
    .filter((item) => !item.isSystem && !item.isPinned)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
