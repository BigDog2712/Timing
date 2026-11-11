/**
 * [v2 · 0.12.1末] 仪表盘布局契约：**网格定位**。
 *
 * 从 v1 的「双列 + 列内顺序 + 每卡占自己列的四等分」升级为「4 列网格 + 起始列 x + 占宽 w」，
 * 目标是安卓桌面小组件式的自由排列：任何卡可以被拖到任意格、可跨列、可换行。
 *
 * 模型只有两个几何自由度：
 *   · `x` —— 起始列（0..COLS-1），左起。
 *   · `w` —— 占宽（1..COLS），约束 `x + w <= COLS`。
 * 高度维度用「行」：基准行高 = 计时分布卡（264px），一张卡占 1 行；内容多的卡（应用排行/
 * 待办）可占 2 行（`h: 2`）。卡在网格里的**行序**由渲染端按「先 x 后序」自动流式排布，
 * 布局模型**不存 y** —— 存 y 会引入「拖动重排后要重算所有 y」的维护，而流式排布
 * （grid-auto-flow: dense）让卡片自动向上补空，正是小组件桌面的行为。
 *
 * v1 数据（`column` / `split` / 每列四等分 width）不再迁移：`LAYOUT_VERSION` 升 2，
 * `normalizeLayout` 对 `version !== 2` 直接回默认（用户已存布局重置一次，主人认可）。
 */
export const CARD_IDS = [
  "timer",
  "items",
  "apps",
  "todos",
  "notes",
  "trend",
  "reminder",
  "timeline",
] as const;

export type CardId = (typeof CARD_IDS)[number];

/**
 * **真的能渲染出来**的卡。加卡弹层只列这些，别的加了也是一个占位框。
 */
export const IMPLEMENTED_CARDS: readonly CardId[] = [
  "timer", "items", "apps", "todos", "notes", "timeline", "trend", "reminder",
];

export function isCardImplemented(id: CardId): boolean {
  return IMPLEMENTED_CARDS.includes(id);
}

/** 档位：S/M/L —— 改的是**高度**（行高倍数），不是宽度。 */
export type CardTier = "S" | "M" | "L";

/** 网格列数：4。改了这里要同步 `dashboard.css` 的 `.qp-grid` 的 `repeat(N, …)`。 */
export const COLS = 4;

export interface LayoutCard {
  id: CardId;
  /** 起始列（0..COLS-1）。缺省 = 0。 */
  x: number;
  /** 占宽（1..COLS），约束 x + w <= COLS。缺省 = 1（一个基准格）。 */
  w: number;
  /** 占行数（1..2）。缺省 = 1（基准行高 = 计时分布卡 264px）。 */
  h: number;
  tier: CardTier;
  /**
   * 组件参数（P2）。**一个卡一个字典**，键由各卡自己解释。
   */
  options?: Record<string, string>;
}

/**
 * 网格卡在「流式排布」下的最小占位：宽 w 格、高 h 行。行序不存，渲染端用
 * `grid-auto-flow: dense` + `order`（= cards 数组顺序）自动流式补位。
 */
export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  cards: LayoutCard[];
}

export const LAYOUT_VERSION = 2;
/** 单键持久化：v2 换新键，避免与 v1 的 `column` 结构混读（旧键 `patina:dashboard-layout:v1` 作废）。 */
export const LAYOUT_STORAGE_KEY = "patina:dashboard-layout:v2";

export const DEFAULT_TIER: CardTier = "M";

/** 基准行高（= 计时分布卡 264px）。所有卡高 = 该值 × h，S/L 档在此基础上下调/上调。 */
export const BASE_ROW_HEIGHT = 264;
/** 一行占几个基准行高（档位换算用，M 档 = 1 行基准高）。 */
export const MAX_ROW_SPAN = 2;

/** 吸附起始列到 [0, COLS-1]。 */
export function clampX(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(COLS - 1, Math.max(0, value)));
}

/** 吸附占宽到 [1, COLS]，且 x + w <= COLS（越界就压到能放下的最大宽）。 */
export function clampW(value: number, x: number): number {
  if (!Number.isFinite(value)) return 1;
  const snapped = Math.round(value);
  const max = COLS - clampX(x);
  return Math.min(max, Math.max(1, snapped));
}

/** 吸附占行到 [1, MAX_ROW_SPAN]。 */
export function clampH(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(MAX_ROW_SPAN, Math.max(1, value)));
}

/**
 * 可在「加卡」里出现的卡（与 `CARD_IDS` 一致；移除后从这里再添回来）。
 */
export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && (CARD_IDS as readonly string[]).includes(value);
}

export function isCardTier(value: unknown): value is CardTier {
  return value === "S" || value === "M" || value === "L";
}

/** 组件参数只收「字符串 → 字符串」；别的形状一律视为没有。 */
export function sanitizeOptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.length > 0) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
