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
 *
 * [0.12.1 归一] **localStorage 退化成首帧缓存**：外观 / 手柄绑定的真源搬进宿主设置表
 * （Rust `timing.pill_prefs`），读写经 `platform/desktop/pillPrefsGateway.ts`。
 * 本地这份只允许两个用途 —— `main.tsx` 启动时同步取一次防闪、从 Rust 读到值之后回写。
 * 本文件同时承担「Rust 送来的未知输入 → 归一化」的解析（`parsePillPrefs`）：解析规则
 * 与写入规则必须同一处，否则「存进去能存、读出来变样」。
 */
import { parseHandleBindings } from './handleBindings';
import { HANDLE_FORMS } from './handleCatalog';
import type { HandleBindings } from './handleCatalog';
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

/**
 * [0.12.1 归一] 跨窗即时信号（设置页 → 悬浮条）。
 *
 * 它**不再携带值**，只是一个「该重读了」的提示：真源是宿主设置表，收到信号的一方
 * 自己去 `get_settings` 读。携带值的版本（0.12.1）是权宜之计 —— 那时真源是两窗各自的
 * localStorage，只能靠搬运对齐；现在留载荷只会让「谁是权威」又变模糊。
 *
 * 为什么还要这个信号：`focus` / `pointerenter` 三条时间信号覆盖的是「用户回到悬浮条」，
 * 而用户改完设置**当前**就看着悬浮条（两窗同屏）时，那条通道要等到下一次焦点切换。
 * 事件表仍是 11 个（本常量是前端自用的窗口间广播，不是 Rust 事件）。
 */
export const PILL_PREFS_EVENT = 'timing:pill-prefs';

/** [0.12.1 归一] 药丸外观（宿主设置表里的形状，与 Rust `PillAppearance` 逐字对齐）。 */
export interface PillAppearance {
  /** 文字不透明度 0.2–1 */
  textOpacity: number;
  /** 背景板不透明度 0–1 */
  bgOpacity: number;
  /** 常驻形态（归一化后只可能是 `bar` / `dot`） */
  floatForm: FloatForm;
}

/** [0.12.1 归一] 完整偏好快照 = `get_settings` 的 `pill` 字段。 */
export interface PillPrefs {
  appearance: PillAppearance;
  handles: HandleBindings;
}

/** [0.12.1 归一] 部分更新 = `update_settings` 的 `patch.pill`：两个字段各自可选。 */
export interface PillPrefsPatch {
  appearance?: PillAppearance;
  handles?: HandleBindings;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 外观严格解析：`textOpacity` / `bgOpacity` / `floatForm` **缺任何一个就回 `null`**。
 *
 * 为什么这里不回落到默认值：调用方要靠 `null` 区分「Rust 里没有这份数据」与「Rust 里有
 * 但坏了」——前者保留现值、后者也保留现值（不拿默认值盖掉用户设置）。
 * 只认三个键（多出来的键忽略），因为形状由 Rust `PillAppearance` 定义，多出来的东西
 * 只可能是别人写错地方。
 *
 * `floatForm` 的口径（**写死**）：是字符串就交给 `normalizeFloatForm`（未知形态回落
 * `bar`，与 Rust `normalize_float_form` 同口径），不是字符串才回 `null`。理由：形态是
 * 封闭枚举，一个陌生值等价于「旧版没这个值」，回落比整份丢弃更符合用户预期；而
 * 「字段类型都不对」是结构坏了，那时整份丢弃。
 */
function parsePillAppearance(raw: unknown): PillAppearance | null {
  if (!isPlainObject(raw)) return null;
  const { textOpacity, bgOpacity, floatForm } = raw;
  if (
    typeof textOpacity !== 'number' ||
    typeof bgOpacity !== 'number' ||
    typeof floatForm !== 'string'
  ) {
    return null;
  }
  return {
    textOpacity: clamp(textOpacity, TEXT_OPACITY_MIN, 1),
    bgOpacity: clamp(bgOpacity, 0, 1),
    floatForm: normalizeFloatForm(floatForm),
  };
}

/**
 * 手柄绑定严格解析：先做**形状检查**（三个形态都在、都带布尔 `enabled` 与对象 `slots`），
 * 形状不齐 → `null`；形状齐了才交给 `parseHandleBindings` 归一。
 *
 * 为什么不能直接用 `parseHandleBindings`：它对坏数据的策略是「回落默认」，而这里需要
 * 「整份丢弃」才能让调用方把 `null` 读成「没有这份数据」，不至于用一份默认绑定把用户的
 * 真实配置覆盖掉。两层各管一件事：本函数判**结构有无**，目录层判**值合不合法**
 * （未知动作 id → `null` 槽，那是「无」，不是坏数据）。
 */
function parsePillHandles(raw: unknown): HandleBindings | null {
  if (!isPlainObject(raw)) return null;
  for (const form of HANDLE_FORMS) {
    const one = raw[form];
    if (!isPlainObject(one)) return null;
    if (typeof one.enabled !== 'boolean' || !isPlainObject(one.slots)) return null;
  }
  /* `parseHandleBindings` 的外壳是 `{ version: 1, forms }`（localStorage 那份带版本位），
     Rust 快照里没有版本位 —— 这里补一个，让「读库」与「读盘」共用同一套归一规则。 */
  return parseHandleBindings({ version: 1, forms: raw });
}

/**
 * Rust `get_settings().pill` → 归一化后的偏好快照；**坏形状回 `null`**（调用方保留现值）。
 *
 * 唯一入口：网关（`platform/desktop/pillPrefsGateway.ts`）与单测都走它 —— 前端对
 * 「宿主送来的东西」的判断只有这一处，别在网关里再写一遍形状检查。
 */
export function parsePillPrefs(raw: unknown): PillPrefs | null {
  if (!isPlainObject(raw)) return null;
  const appearance = parsePillAppearance(raw.appearance);
  const handles = parsePillHandles(raw.handles);
  if (!appearance || !handles) return null;
  return { appearance, handles };
}

