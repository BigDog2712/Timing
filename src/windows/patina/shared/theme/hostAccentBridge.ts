/**
 * 宿主四色 → 分析窗 `--qp-*`（P0-01：配色单一来源）
 * -----------------------------------------------------------------------------
 * 融合后「一套配色」不是再放一个主色控件，而是把**宿主的四色**派生成分析窗的强调/语义
 * 令牌。本文件是全仓唯一做这件事的地方：纯函数，无 IPC、无 DOM。逐项见 ARCH §4.3：
 *   running → `--qp-accent-default` / `-muted` / `--qp-button-primary-bg` / `--qp-chart-cursor`
 *   done    → `--qp-success`；warn → `--qp-warning`
 *   （无来源）`--qp-danger` / `--qp-participation` ← **保持 `deriveTheme` 原值，不覆盖**
 *             （宿主四色没有这两个键，见 `src/lib/theme.ts` 的 ACCENT_KEYS）
 *   bar     → **不映射**：药丸底板色（`--pill-hover-plate` 消费），分析窗无对应语义
 * 其余 20 个中性键（`--qp-bg-*` / `--qp-border-*` / `--qp-text-*` / `--qp-control-*`
 * / `--qp-track-muted` / `--qp-badge-subtle` / `--qp-scrollbar-*` / `--qp-chart-grid`
 * / `--qp-chart-track`）**一个都不碰**——这就是「中性底色仍由 28 套预设决定」的边界线。
 */
import { primaryButtonBackground } from "./deriveTheme.ts";
import type { ThemeVariant } from "./themePresets.ts";

/** 宿主四色的分析窗副本（字段名与后端 `AccentColors` 逐字一致，改一处两处同改）；`src/types/domain`
 * 里那份属**主窗**根目录，L9 禁跨窗 import（连 `import type` 也算）。 */
export interface HostAccentColors {
  running: string;
  warn: string;
  done: string;
  bar: string | null;
}

/** 会被宿主四色覆盖的 6 个键（§4.3 的另外 2 行是「显式不覆盖」）。 */
export type HostAccentTokenKey =
  | "--qp-accent-default" | "--qp-accent-muted" | "--qp-button-primary-bg"
  | "--qp-chart-cursor" | "--qp-success" | "--qp-warning";

export type HostAccentOverrides = Partial<Record<HostAccentTokenKey, string>>;

/* 颜色数学：与 `src/lib/theme.ts:59-122` 的 isValidHex / hexToRgb / toHex / channelLin
 * / relLum / contrast / deepenForNonText / deepenForText **逐字同构**（只把 isValidHex 改名
 * isValidHostHex 以免与宿主同名混淆）。为什么复制：L9 红线（ARCH §1.1.1 第 5 条）——`src/lib/**`
 * 属主窗。宿主浅色下写入 `--color-*` 的是**派生后**的 hex，`accent_get` 返回的却是**用户
 * 原始值**，分析窗必须自己算一遍才对得上同一套配色。
 * **改一处必须两处同改**；漂移由 `hostAccentBridge.test.ts` 的固定向量 + 源码文本哨兵双锁。 */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidHostHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, "0");
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

/** 保色相降亮度，直到对底色（亮度 bgLum）的**非文本**对比度 ≥ target（默认 3:1）。 */
export function deepenForNonText(hex: string, bgLum: number, target = 3): string {
  if (!isValidHostHex(hex)) return hex;
  let { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < 24; i += 1) {
    if (contrast(relLum(r, g, b), bgLum) >= target) break;
    r *= 0.95;
    g *= 0.95;
    b *= 0.95;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** **文字**用法：对最坏底达标 ≥4.5:1。与宿主同算法，仅默认目标不同（勿换 HSL 写法）。 */
export function deepenForText(hex: string, bgLum: number, target = 4.5): string {
  return deepenForNonText(hex, bgLum, target);
}

/** 底色亮度；token 缺失/非 hex 时用宿主同款常量回落（宁可多加深，不可读不清）。 */
function luminanceOf(hex: string | undefined, fallback: number): number {
  if (typeof hex !== "string" || !isValidHostHex(hex)) return fallback;
  const { r, g, b } = hexToRgb(hex);
  return relLum(r, g, b);
}

/** 宿主 `applyAccents` 的两块基准底（`src/lib/theme.ts:157-159`），逐字同值。 */
const PANEL_LUM_FALLBACK = relLum(255, 255, 255);
const PLATE_LUM_FALLBACK = relLum(242, 243, 245);

/**
 * 展开成 6 位小写 `#rrggbb`。不是为了好看：`primaryButtonBackground` 的 `parse` 假定 6 位，
 * 直接喂 `#abc` 会算出 `#0000NaN`——宿主只喂预设色（恒 6 位），分析窗是第一个把用户输入
 * 喂进去的调用方，必须在这里收口。
 */
function normalizeHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const warned = new Set<string>();

/** 非法值只提醒一次（dev），生产静默——§4.3 注 3：不许刷日志。 */
function warnInvalid(key: string, value: unknown): void {
  const stamp = `${key}:${String(value)}`;
  if (warned.has(stamp)) return;
  warned.add(stamp);
  if (import.meta.env?.DEV) {
    console.warn(`[theme] host accent "${key}" is not #RGB/#RRGGBB (${String(value)}); keeping preset`);
  }
}

/**
 * 把宿主四色派生成 `--qp-*` 覆盖值（§4.3）。`baseTokens` 是 `deriveTheme` **未被覆盖前**
 * 的输出，只读三个中性键：强调弱化档要的 `{surface}` = `--qp-bg-canvas`，浅色达标派生要的
 * `--qp-bg-panel` / `--qp-bg-elevated` 亮度。`accents` 为 `null`（ACL / 宿主库未就绪）时返回
 * 空对象，调用方原样保留预设色——宁可配色是预设的，也不能因为读不到四色而白屏。
 * `variant` 是**实际生效**的深/浅（不是 `themeMode`：`system` 已解析过）。
 * 返回的增量只含 6 个键，`Object.assign` 回 tokens 即可，不含 danger / participation。
 */
export function applyHostAccents(
  baseTokens: Record<string, string>,
  accents: HostAccentColors | null,
  variant: ThemeVariant,
): HostAccentOverrides {
  if (!accents) return {};
  const dark = variant === "dark";
  /* 弱化档底色用 `{surface}`（= `--qp-bg-canvas`），与 `deriveTheme.ts:101,120` 同一变量。 */
  const surface = baseTokens["--qp-bg-canvas"] ?? (dark ? "#262626" : "#fbfbfb");
  const panelLum = luminanceOf(baseTokens["--qp-bg-panel"], PANEL_LUM_FALLBACK);
  /* 分析窗没有宿主的 `--bg-plate`；`--qp-bg-elevated` 是同一角色（面板上的卡片底），
     浅色下恒比 panel 暗，作「文字最坏底」只会更保守。 */
  const plateLum = luminanceOf(baseTokens["--qp-bg-elevated"], PLATE_LUM_FALLBACK);

  const read = (key: "running" | "warn" | "done"): string | null => {
    const raw = accents[key];
    if (typeof raw !== "string" || !isValidHostHex(raw)) {
      warnInvalid(key, raw);
      return null;
    }
    return normalizeHex(raw);
  };

  const overrides: HostAccentOverrides = {};

  const running = read("running");
  if (running) {
    /* 注 2：浅色下宿主写入 `--color-running` 的是派生值（非文本 ≥3:1），分析窗自己算一遍。 */
    const accent = dark ? running : deepenForNonText(running, panelLum, 3);
    overrides["--qp-accent-default"] = accent;
    overrides["--qp-accent-muted"] = `color-mix(in srgb, ${accent} ${dark ? 20 : 14}%, ${surface})`;
    overrides["--qp-button-primary-bg"] = primaryButtonBackground(accent);
    overrides["--qp-chart-cursor"] = `color-mix(in srgb, ${accent} ${dark ? 14 : 12}%, transparent)`;
  }

  const done = read("done");
  if (done) {
    /* 语义「成功/完成」；勾选/校验图标属非文本，同一档 ≥3:1。 */
    overrides["--qp-success"] = dark ? done : deepenForNonText(done, panelLum, 3);
  }

  const warn = read("warn");
  if (warn) {
    /* 语义「提醒」；在分析窗会作**小字**出现（逾期/提醒角标），故按文字口径 ≥4.5:1。 */
    overrides["--qp-warning"] = dark ? warn : deepenForText(warn, plateLum, 4.5);
  }

  return overrides;
}
