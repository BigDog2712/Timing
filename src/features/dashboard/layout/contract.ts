/**
 * [P1 · 0.12.1] 仪表盘布局契约：**这一层只描述「哪张卡、在哪列、什么档」**，不碰像素。
 *
 * 为什么先有契约：P1 的验收 B1/B2 要求「换上新骨架后与今天逐像素一致」，
 * 而今天的几何是 CSS 令牌（`--qp-mod-timer` 等）给的四条固定行高。所以布局模型不描述高度，
 * 只描述**行序**：渲染端按列生成 `grid-template-rows: var(--qp-mod-x) ...`，
 * 默认布局生成的串与 `.qp-col-left/right` 里那两条硬编码**逐字相同** —— 零像素回归靠这条成立，
 * 不靠「看起来一样」。
 *
 * 口径（2026-11-11 主人认可「按默认走」）：双列轨道 + 卡序 + 跨列 + 三档高；不做自由像素摆位。
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
/** 档位：S/M/L。默认档必须等于今天的行高，见 `defaultLayout.ts`。 */
export type CardTier = "S" | "M" | "L";
/** 列：左列 / 右列 / 通栏（通栏卡排在双列之后，如便利贴）。 */
export type CardColumn = "left" | "right" | "full";

export interface LayoutCard {
  id: CardId;
  column: CardColumn;
  tier: CardTier;
  /**
   * 组件参数（P2）。**一个卡一个字典**，键由各卡自己解释 —— 布局层不校验业务值。
   * 到 P2 只有专注卡用：`{ dimension: "category" | "app" | "title" }`。
   * 刻意不放进顶层：参数是卡的属性，摊平到 layout 上必然出现 `timerDimension` 这类前缀键。
   */
  options?: Record<string, string>;
}

export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  cards: LayoutCard[];
}

export const LAYOUT_VERSION = 1;
/** 单键持久化：布局是**一个**整体，拆成多个键必然出现半旧半新。 */
export const LAYOUT_STORAGE_KEY = "patina:dashboard-layout:v1";

export const DEFAULT_TIER: CardTier = "M";

/**
 * 行高令牌：只有这四张卡是「列内的一行」，其余（notes/trend/reminder/timeline）是通栏卡，
 * 高度由自身内容与 CSS 决定，不进 `grid-template-rows`。
 */
export const CARD_ROW_TOKEN: Partial<Record<CardId, string>> = {
  timer: "--qp-mod-timer",
  items: "--qp-mod-items",
  apps: "--qp-mod-apps",
  todos: "--qp-mod-todos",
};

/** 可在「加卡」里出现的卡（与 `CARD_IDS` 一致；移除后从这里再添回来）。 */
export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && (CARD_IDS as readonly string[]).includes(value);
}

export function isCardColumn(value: unknown): value is CardColumn {
  return value === "left" || value === "right" || value === "full";
}

export function isCardTier(value: unknown): value is CardTier {
  return value === "S" || value === "M" || value === "L";
}

/** 组件参数只收「字符串 → 字符串」；别的形状一律视为没有（宁可回默认，也不吞一个坏对象）。 */
export function sanitizeOptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.length > 0) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 卡 × 档 → 高度令牌名。
 *
 * `M` 档刻意**不**造 `--qp-mod-timer-m`：M 就是今天那五个 `--qp-mod-*`。
 * 多一份同值副本，改档位时必然出现「改了 S/L、M 没跟上」或反过来。
 */
export function cardRowToken(id: CardId, tier: CardTier): string | null {
  const base = CARD_ROW_TOKEN[id];
  if (!base) return null;
  return tier === "M" ? base : `${base}-${tier.toLowerCase()}`;
}

/** 列内行序 → `grid-template-rows` 的值。空列返回 `[]`，调用端据此不写内联样式。 */
export function columnRowTokens(cards: readonly LayoutCard[]): string[] {
  return cards
    .filter((card) => card.column !== "full")
    .map((card) => cardRowToken(card.id, card.tier))
    .filter((token): token is string => Boolean(token))
    /* `minmax(0, …)` 而不是裸 `var(…)`：行高是固定像素，窗口比板子矮时（加卡工具条占位、
       多张通栏卡挤压）裸值会**溢出列**，卡片就压到下一张身上。minmax 让它按需收缩，
       空间够时与裸值逐像素相同 —— 零像素回归（B1/B2）不受影响。 */
    .map((token) => `minmax(0, var(${token}))`);
}
