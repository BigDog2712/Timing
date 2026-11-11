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

/**
 * **真的能渲染出来**的卡。加卡弹层只列这些，别的加了也是一个占位框。
 *
 * 为什么要这张表：上一版把 `trend` / `reminder` 也列进目录，但 `renderFullCard` 对它们
 * 返回 `null` —— 用户点了「添加」，板上多出一个**看不见的空槽**（还占着高度），
 * 表现就是「新增的图窗未显示」。现在两头都堵：目录不列没做的卡；已存布局里若出现，
 * 渲染成一张写着「未实现」的占位卡，至少看得见、能移除。
 */
export const IMPLEMENTED_CARDS: readonly CardId[] = [
  "timer", "items", "apps", "todos", "notes", "timeline",
];

export function isCardImplemented(id: CardId): boolean {
  return IMPLEMENTED_CARDS.includes(id);
}
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
  /**
   * [拖拽调整大小 · 0.12.1] 用户拖出来的高度（css px）。
   *
   * 优先级：`height` 存在就压过 `tier`；切档（`setCardTier`）会**清掉** height，
   * 否则会出现「拖过之后点 S/M/L 没反应」——两个真相源同时生效，用户判断不了哪个算数。
   */
  height?: number;
}

/** 拖动下限：再矮卡头 + 一行数据都放不下，拖到 120 以下没有意义。 */
export const MIN_CARD_HEIGHT = 120;
/** 上限：单卡超过这个高度，另一张会被压没（列内共享列高）。 */
export const MAX_CARD_HEIGHT = 560;

export function clampCardHeight(value: number): number {
  if (!Number.isFinite(value)) return MIN_CARD_HEIGHT;
  return Math.round(Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, value)));
}

export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  cards: LayoutCard[];
  /**
   * [列宽比可拖 · 0.12.1] 左列的 fr 权重，右列 = `SPLIT_TOTAL - split`。
   *
   * 为什么是 fr 权重而不是百分比：两列本来就是 `44fr / 54fr` 分配的，直接沿用同一套
   * 加权（44 + 54 = 98）才能保证默认值下与今天的 465.14 / 570.86 逐像素相等；
   * 换成百分比会引入一次取整，那个像素锁当场失效。
   *
   * 放在顶层而不是卡上：它是**板子**的属性，不是某张卡的属性（与 `options` 相反）。
   */
  split?: number;
}

export const LAYOUT_VERSION = 1;
/** 单键持久化：布局是**一个**整体，拆成多个键必然出现半旧半新。 */
export const LAYOUT_STORAGE_KEY = "patina:dashboard-layout:v1";

export const DEFAULT_TIER: CardTier = "M";

/**
 * 列宽比。`DEFAULT_SPLIT = 44` 且 `SPLIT_TOTAL = 98` → 44:54，等于今天的双列。
 * 夹在 30..68 是因为再往外拖，左列会被 `minmax(320px, …)` 顶住、右列塌到放不下数字列。
 */
export const DEFAULT_SPLIT = 44;
export const SPLIT_TOTAL = 98;
export const MIN_SPLIT = 30;
export const MAX_SPLIT = 68;

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT;
  return Math.round(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value)));
}

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
    .map((card) => {
      /* 拖过的高度优先：用户亲眼看着拖出来的值，比三档令牌更"真"。 */
      if (typeof card.height === "number") return `minmax(0, ${clampCardHeight(card.height)}px)`;
      const token = cardRowToken(card.id, card.tier);
      return token ? `minmax(0, var(${token}))` : null;
    })
    .filter((row): row is string => Boolean(row));
}
