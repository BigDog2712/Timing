/**
 * TickBar — 主题 / 四色运行时（唯一写入 <html> 主题与 --color-* 的出口）
 * -----------------------------------------------------------------------------
 * 依据 DESIGN-V0.2.0.md §10 + ADR-012：
 *   - 载体 <html data-theme="dark|light">（属性切换，非 class）；system 用
 *     matchMedia('(prefers-color-scheme: dark)') 解析。
 *   - 持久化 localStorage 供 index.html 内联脚本抢在首帧前读取（K-1）。
 *     [V0.5.0] 键从 `tickbar.theme` 改为 `timing.theme`，老键只读回落一个版本
 *     （读写统一走 `lib/storageKeys.ts`，这里不再出现键字面量）。
 *   - 四色注入 documentElement.style（--color-running/warn/done/bar）：
 *     · 值 == 出厂默认（DEFAULT_ACCENTS）→ **不写内联**，回落分主题令牌
 *       （深 #4DA3E8/#E8A33D/#4CC38A，浅 #1669AD/#A05E00/#0C7E47）⇒ 出厂态与设计稿/审计一致；
 *     · 值 != 默认 → 浅色派生达标后写入（warn 作**文字**≥4.5:1，running/done 作**非文本**≥3:1）；
 *       深色直接用用户原值。派生只改渲染层，不动用户存的原始色（DESIGN §10.2 注 4）。
 *   - 非法 hex 一律拒绝（与后端 INVALID_COLOR 呼应）。
 */
import type { AccentColors, ThemeMode } from '../types/domain';
import { readKeyWithLegacy, writeKey } from './storageKeys';

export type ResolvedTheme = 'dark' | 'light';

/** 用户可配色的 KEY（bar 允许 null = 跟随主题令牌） */
export type AccentKey = 'running' | 'warn' | 'done' | 'bar';

export const ACCENT_KEYS: readonly AccentKey[] = ['running', 'warn', 'done', 'bar'] as const;

/** 各配色对应的 CSS 变量（写入 documentElement.style） */
const ACCENT_VAR: Record<AccentKey, string> = {
  running: '--color-running',
  warn: '--color-warn',
  done: '--color-done',
  bar: '--color-bar',
};

/** 默认四色（与 settingsStore.DEFAULT_SETTINGS.accents 同源） */
export const DEFAULT_ACCENTS: AccentColors = {
  running: '#4DA3E8',
  warn: '#E8A33D',
  done: '#4CC38A',
  bar: null,
};

/** bar 未配置（null = 跟随主题令牌）时，取色器/色点回退展示的深色底色 */
export const ACCENT_BAR_DEFAULT_HEX = '#0E0F12';

/** 该键的值是否等于出厂默认（大小写不敏感）——是则**不写内联**，回落分主题令牌 */
function isFactoryDefault(key: AccentKey, value: string): boolean {
  const def = DEFAULT_ACCENTS[key];
  return def != null && def.toLowerCase() === value.trim().toLowerCase();
}

/** 四色行展示文本：bar 允许 null（跟随主题） */
export function accentHex(key: AccentKey, colors: AccentColors): string {
  const value = colors[key];
  if (value) return value;
  return key === 'bar' ? ACCENT_BAR_DEFAULT_HEX : DEFAULT_ACCENTS[key] ?? ACCENT_BAR_DEFAULT_HEX;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 校验 hex（#RGB / #RRGGBB）。非法 → accentSet 应返回 INVALID_COLOR */
export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/* ------------------------------ 颜色数学 ------------------------------ */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().slice(1);
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0');
}

function channelLin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLum(r: number, g: number, b: number): number {
  return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b);
}

function contrast(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * DeepenForNonText：保色相、按 0.95 步进加深，直到对给定底色（亮度 bgLum）
 * 的非文本对比度 ≥ target（默认 3.0）。浅色主题保证色环/竖条可读。
 *
 * 实现说明（DESIGN §10.2）：RGB 各通道**等比步进**（×0.95）在 L<0.5 区间与
 * 「HSL 保 H、保 S、仅降 L」**数学等价**，故本函数即「保色相降亮度」的合规实现；
 * 勿另换 HSL 写法（换写法无行为收益，反增回归面）。
 */
export function deepenForNonText(hex: string, bgLum: number, target = 3): string {
  if (!isValidHex(hex)) return hex;
  let { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < 24; i += 1) {
    if (contrast(relLum(r, g, b), bgLum) >= target) break;
    r *= 0.95;
    g *= 0.95;
    b *= 0.95;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * DeepenForText：**文字**用法（提醒铃 / 「已逾期」小字）保色相加深，
 * 对**最坏底** `--bg-plate` 达标 ≥4.5:1（WCAG 2.1 AA 正文）。
 * 与 deepenForNonText 同一算法，仅默认目标不同（DESIGN §10.2 注 3）。
 */
export function deepenForText(hex: string, bgLum: number, target = 4.5): string {
  return deepenForNonText(hex, bgLum, target);
}

/* ------------------------------ 主题解析 ------------------------------ */

/** 解析主题模式 -> 实际 dark / light（system 读系统偏好） */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    return mq?.matches ? 'dark' : 'light';
  }
  return mode;
}

/** 应用主题：写 <html data-theme> + 同步 meta[color-scheme]；返回解析后的主题 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', resolved);
  return resolved;
}

/**
 * 应用四色：写入根节点 --color-*。
 * - 值 == 出厂默认 → **不写内联**（回落分主题令牌，出厂态 = 设计稿/审计值）；
 * - 值 != 默认 → 浅色派生达标后写入（warn 作文字 ≥4.5，running/done 作非文本 ≥3），深色用原值；
 * - bar=null 时移除内联覆盖，回落到主题令牌。
 */
export function applyAccents(colors: AccentColors, resolved: ResolvedTheme): void {
  const style = document.documentElement.style;
  const isLight = resolved === 'light';
  /** 非文本基准底 = `--bg-panel`（浅 #FFFFFF / 深 #0E1015） */
  const panelLum = relLum(255, 255, 255);
  /** 文字最坏基准底 = `--bg-plate`（浅 #F2F3F5；深色不派生故不用） */
  const plateLum = relLum(242, 243, 245);

  (['running', 'warn', 'done'] as const).forEach((key) => {
    const value = colors[key];
    // 非法 hex / 出厂默认 → 不写内联，回落分主题令牌（--accent / --warn / --ok）
    if (!isValidHex(value) || isFactoryDefault(key, value)) {
      style.removeProperty(ACCENT_VAR[key]);
      return;
    }
    if (!isLight) {
      style.setProperty(ACCENT_VAR[key], value);
      return;
    }
    // 浅色：warn 作**文字**用（提醒铃 / 已逾期）须 ≥4.5:1；running/done 作**非文本**用（环/图标）≥3:1
    style.setProperty(
      ACCENT_VAR[key],
      key === 'warn' ? deepenForText(value, plateLum) : deepenForNonText(value, panelLum),
    );
  });

  if (colors.bar && isValidHex(colors.bar)) style.setProperty(ACCENT_VAR.bar, colors.bar);
  else style.removeProperty(ACCENT_VAR.bar);
}

/* ------------------------------ 持久化快取 ------------------------------ */

export function readCachedTheme(): ThemeMode {
  try {
    /* 新键优先，无则回落老键 tickbar.theme（命中即回写新键，见 lib/storageKeys.ts） */
    const raw = readKeyWithLegacy('theme');
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  } catch {
    /* localStorage 不可用（隐私模式等）时回退默认 */
  }
  return 'dark';
}

export function writeCachedTheme(mode: ThemeMode): void {
  writeKey('theme', mode);
}
