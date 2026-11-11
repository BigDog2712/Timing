/**
 * Timing — 药丸外观的**唯一读写口径**（[0.12.1] T04：设置搬进主界面）
 * -----------------------------------------------------------------------------
 * 为什么把「读 / 写 / 归一化」从 `stores/appearanceStore.ts` 挪到这里：
 *  主界面设置页（分析窗 `src/features/settings/**`）也要读写这三项，而它读不到宿主
 *  `src/stores/**`（zustand + 副作用，L9 双窗隔离）。能共享的只能是「无状态、无框架」的
 *  纯数据 + 纯 IO 模块 —— 与 `lib/handleCatalog` / `lib/handleBindings` 同一理由。
 *
 * **单一写路径**：`appearanceStore.commit()` 不再自己 clamp / 归一化 / 拼 JSON，而是调
 *  `writePillAppearance()`；主界面的滑杆也调同一个函数。两处写同一键必须只有一条路，
 *  否则「百分比 20% 与 0.2」这类归一化迟早分叉。
 *
 * 键仍是 `timing.appearance.v1`（形状不变：`textOpacity` / `bgOpacity` / `floatForm`），
 * 键字面量仍然只出现在 `src/lib/storageKeys.ts` —— 本文件只按名字读写。
 */
import { readKeyWithLegacy, writeKey } from './storageKeys';

/** 文字不透明度的下限：再低正文就看不清了 */
export const TEXT_OPACITY_MIN = 0.2;

/** [V0.11.0] 常驻悬浮形态：悬浮条 / 小圆点 */
export type FloatForm = 'bar' | 'dot';

export const FLOAT_FORM_OPTIONS: readonly { id: FloatForm; label: string }[] = [
  { id: 'bar', label: '悬浮条' },
  { id: 'dot', label: '小圆点' },
];

export interface Appearance {
  /** 文字不透明度 0.2–1（1 = 全实） */
  textOpacity: number;
  /** 背景板不透明度 0–1（0 = 全透） */
  bgOpacity: number;
  /** [V0.11.0] 常驻形态（`bar` 默认） */
  floatForm: FloatForm;
}

export const DEFAULT_APPEARANCE: Appearance = { textOpacity: 1, bgOpacity: 1, floatForm: 'bar' };

/** 数值夹取。`NaN`（手改坏的 JSON）当上界，与 V0.2.2 的既有口径逐字一致。 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return max;
  return Math.min(max, Math.max(min, value));
}

/** 只认两个字面量：存进来别的东西（旧版没有这个键、手改坏了）一律回落到悬浮条 */
export function normalizeFloatForm(value: unknown): FloatForm {
  return value === 'dot' ? 'dot' : 'bar';
}

/** 在 `base` 之上叠一层 patch 并归一化（写盘与读盘共用同一条算式，形状永不分叉）。 */
export function normalizeAppearance(patch: Partial<Appearance>, base: Appearance): Appearance {
  return {
    textOpacity: clamp(patch.textOpacity ?? base.textOpacity, TEXT_OPACITY_MIN, 1),
    bgOpacity: clamp(patch.bgOpacity ?? base.bgOpacity, 0, 1),
    floatForm: normalizeFloatForm(patch.floatForm ?? base.floatForm),
  };
}

/**
 * 从 localStorage 读一次外观。**永不 throw**（读坏 / 没存 / 无 localStorage 都回落默认），
 * 也**从不写盘**：`load` 路径没有 `setItem`，用户手改坏的值不会被我们悄悄覆盖。
 */
export function readPillAppearance(): Appearance {
  try {
    const raw = readKeyWithLegacy('appearance');
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return normalizeAppearance(parsed, DEFAULT_APPEARANCE);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * 把 patch 合并进当前值并落盘，返回落盘后的完整值。
 *
 * 「读 → 归一化 → 写」必须在一次调用里做完：调用方只拿得到结果，拿不到中间态，
 * 也就不可能写出「缺 floatForm 的一半对象」。读取失败（无 localStorage）时静默返回合并值，
 * 界面照样即时生效，只是本次不持久化 —— 不做「存不上就白屏」。
 */
export function writePillAppearance(patch: Partial<Appearance>): Appearance {
  const next = normalizeAppearance(patch, readPillAppearance());
  writeKey('appearance', JSON.stringify(next));
  return next;
}
