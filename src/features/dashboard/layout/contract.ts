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
  "timer", "items", "apps", "todos", "notes", "timeline", "trend", "reminder",
];

export function isCardImplemented(id: CardId): boolean {
  return IMPLEMENTED_CARDS.includes(id);
}
/**
 * **天生通栏**的卡：它们没有列内行高令牌，也不该被「收回单列」。
 *
 * 唯一出处：`normalizeLayout` 拿它判合法列，`Dashboard` 拿它决定卡头要不要出「跨列」键。
 * 两处各写一份的话，加一张新卡必然只改一处 —— 症状是「点了跨列，刷新弹回去」。
 */
export const FULL_ONLY_CARDS: readonly CardId[] = ["notes", "trend", "reminder", "timeline"];

/** 有列内行高令牌的卡：可待在列内，**也可以跨满两列**。 */
export const ROW_CARDS: readonly CardId[] = ["timer", "items", "apps", "todos"];

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
  /**
   * [单独宽度 · 0.12.1] 占**自己那一列**的百分比，只有 25 / 50 / 75 / 100 四档。
   *
   * 为什么按「列」而不是「板」：两列的宽度已经由 `split` 那根分隔条决定，若宽度按整块板
   * 算，同一张卡在窗口换宽后要重算、且和 `split` 抢同一块空间。按列算 = 卡只说
   * 「我占这一列的四分之几」，两根轴各管各的，改一根不会让另一根跳。
   *
   * 缺省（不写）= 100 = 占满整列，所以老布局读出来与今天逐像素一致。
   * 两张 50% 的卡自动并排；跨列（`column: "full"`）时不生效 —— 那时它本来就是整板宽。
   */
  width?: number;
}

/** 拖动下限：再矮卡头 + 一行数据都放不下，拖到 120 以下没有意义。 */
export const MIN_CARD_HEIGHT = 120;
/** 上限：只防「拖出荒谬高度」，不再防「压没邻居」。
 * 0.12.1 二次修复后板子会跟着长高、超出的部分外层滚动，同列另一张保持自己的高度
 * （原先 560 的理由是「列内共享列高」，那条前提已经不成立）。 */
export const MAX_CARD_HEIGHT = 1000;

export function clampCardHeight(value: number): number {
  if (!Number.isFinite(value)) return MIN_CARD_HEIGHT;
  return Math.round(Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, value)));
}

/**
 * 列内宽度的格数：每列再切成 4 格（`dashboard.css` 的 `.qp-col` 是 `repeat(4, …)`）。
 *
 * 为什么是 4：两列之下「整列 / 半列」只够区分一张卡占多数，而 3 档（1/3、2/3）在有 gap 的
 * 网格里除不尽、吸附后视觉不等宽。4 档既能并排两张（各 2 格），也能「一张 3 格 + 一张 1 格」。
 * 格数改了要同步 `.qp-col` 的 `repeat(N, …)`，否则 `span` 会溢出成隐式列。
 */
export const CARD_WIDTH_TRACKS = 4;
export const DEFAULT_CARD_WIDTH = 100;
export const MIN_CARD_WIDTH = DEFAULT_CARD_WIDTH / CARD_WIDTH_TRACKS;

/** 吸附到四等分。宽度是**设定值**，只认整数格；给出 37 这种值就吸到最近的 25 的倍数。 */
export function clampCardWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CARD_WIDTH;
  const snapped = Math.round(value / MIN_CARD_WIDTH) * MIN_CARD_WIDTH;
  return Math.min(DEFAULT_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, snapped));
}

/** 卡片占几格（1..4）。缺省 = 4（占满整列）。 */
export function columnSpan(width?: number): number {
  return Math.round(clampCardWidth(width ?? DEFAULT_CARD_WIDTH) / MIN_CARD_WIDTH);
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
 * **[0.12.1 单独宽度] 高度不再走 `grid-template-rows`**，改由卡槽自己定高
 * （`.qp-card-slot[data-card][data-tier]` → `--qp-slot-h`，见 `dashboard-split.css`）。
 *
 * 为什么换掉那一套（它本来是对的）：`grid-template-rows` 是**一卡一行**的假设。
 * 加了列内宽度之后，两张 50% 的卡会落在**同一行**、共享一个行高的轨道 ——
 * 264 与 284 会互相压，短的那张留白、高的那张被裁。行高必须跟着卡走，不能跟着"第几行"走。
 *
 * 代价是档位映射从 JS 挪进 CSS：`cardRowToken` / `columnRowTokens` 双双删除，
 * 令牌名还是那几个 `--qp-mod-*`（数值不改，所以像素验收照旧）。
 */

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
