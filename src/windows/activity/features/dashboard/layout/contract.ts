/**
 * [v3 · 自由摆位] 主界面组件板契约：**绝对坐标**。
 *
 * 从 v2 的「4 列网格 + 流式补位」换成「一块固定宽度的画布 + 卡片自由摆位」。
 * 动因是主人的原话：**「安卓桌面小组件式」**——网格能对齐，但做不出「两张半宽卡错开
 * 摆一行、便利贴压在中间」这种排法；而 v2 的 `x` 是列号，宽度只能取整格，永远是四等分。
 *
 * 三个自由度，一个都不多：
 *   · `x` / `y` —— 左上角（画布设计点，8px 吸附，见 `geometry.ts`）
 *   · `w` / `h` —— 尺寸（同样 8px 吸附，下限由组件自己声明）
 *
 * **画布坐标是「设计点」，与窗口像素解耦**：`BOARD_W` = 1250 是 `timing-board.exe` 的
 * 设计宽，倍数由**用户**给（Ctrl + 滚轮 / Ctrl + 加减号，见 `useBoardZoom`），默认 1。
 * 窗口变宽变窄**不再**改倍率 —— 要让卡片跟着窗口长大，等于永远看不清细节，而且内容
 * 永远刚好铺满，滚轮永远没东西可滚。布局文件因此也不会因为换显示器而错位。
 *
 * 卡片按 `uid` 标识，不再按「类型唯一」：同一个组件可以放多张，各自有位置/尺寸/标题。
 * 唯一性只剩两条：`uid` 不重复；**同类型可以多张**（加卡弹层不拦重复）。
 */
export const CARD_IDS = [
  "timer",
  "apps",
  "todos",
  "notes",
  "trend",
  "timeline",
  "heatmap",
  "reminder",
] as const;

export type CardId = (typeof CARD_IDS)[number];
/** v3 起 `CardId` 就是「组件类型」；保留别名是为了 v2 时代的模块签名不用逐个改。 */
export type CardKind = CardId;

/** 档位只影响**尺寸预设**（S/M/L 三套宽高），不再参与网格行数计算。 */
export type CardTier = "S" | "M" | "L";
export const DEFAULT_TIER: CardTier = "M";

/**
 * 画布设计宽 = `timing-board.exe` 的 `DESIGN_W`（`layout.rs:64`）。
 *
 * [本轮·照搬] 原来写 1052（默认窗内容宽），那是把 exe 的**点值**硬塞进一个更窄的
 * 设计空间：卡片 518 宽却配 13.5px 的标题，字的相对大小只有 exe 的 2/3，整块板
 * 看着就是"不像"。现在设计空间与 exe 逐点相同（1250×820、三列 340/330/500、
 * PAD 24 / GAP 16），`kit.rs` 里那些 46 / 30 / 12.5 才真正落回 exe 的比例。
 */
export const BOARD_W = 1250;
/** 画布首屏高 = exe 的 `CANVAS_H`（`app.rs:19`）。内容超出即滚，不压缩卡片。 */
export const BOARD_H = 820;
/** 吸附步长：拖拽 / 缩放 / 新建落点都对齐到它。 */
export const SNAP = 8;
/** 全局尺寸硬下限（各组件另有自己的下限，取两者较大值）。 */
export const MIN_W = 240;
export const MIN_H = 120;

/**
 * 三列栅格（`layout.rs:63` 的 `COLUMNS`）：窄 / 窄 / 宽。
 * x 与列宽都是 exe 的原值，列距正好 16（380 − 24 − 340、726 − 380 − 330）。
 * `整理` 与新卡入位都对齐到它。
 */
export const COLUMNS = [
  { x: 24, w: 340 },
  { x: 380, w: 330 },
  { x: 726, w: 500 },
] as const;
/** 卡片与画布边缘、卡片之间的留白（`kit.rs:15-16`）。 */
export const PAD = 24;
export const GAP = 16;

export interface KindSpec {
  /** 设置页 / 加卡弹层里的中文名（设置页文案不进 i18n，见 `settingsGroups.ts` 头注释） */
  label: string;
  /** 加卡弹层的一句说明：这个组件回答什么问题 */
  hint: string;
  minW: number;
  minH: number;
  /** 三档预设尺寸（设计点）。切档只改 w/h，不动 x/y。 */
  sizes: Record<CardTier, readonly [number, number]>;
}

/**
 * 各组件尺寸**逐值照抄** `timing-board.exe` 的 `widgets/mod.rs:64` `SPECS`：
 *   · `minW/minH` = exe 的 `min`（缩到更小就画不下，exe 自己也会夹回去）；
 *   · `sizes.M`   = exe 的 `default_size`（出厂布局与「中」档都用它）；
 *   · `sizes.S`   = 同 `min`（「小」就是最小），`sizes.L` = 换到宽列 500 的排法。
 *
 * 为什么不再自定一套「内容不裁」的下限：口径统一成"exe 能画多大，我们就能画多大"，
 * 用户拿两个窗口并排比的时候，最小尺寸、默认尺寸、三档预设全都对得上，
 * 不会出现"明明同一个组件，一个能缩、一个缩不动"。
 *
 * 便利贴的 320×168 也是 exe 的值（旧值 480×96 让它只能当通栏横条，而且 96 高会裁纸片）。
 */
export const KIND_SPECS: Record<CardKind, KindSpec> = {
  timer: {
    label: "计时分布",
    hint: "今天的时间花在哪：环 + 分类读数",
    minW: 296, minH: 236,
    sizes: { S: [296, 236], M: [340, 304], L: [500, 304] },
  },
  apps: {
    label: "应用排行",
    hint: "今天用电脑的时间落在哪些应用上",
    minW: 288, minH: 208,
    sizes: { S: [288, 208], M: [330, 304], L: [500, 304] },
  },
  todos: {
    label: "待办事项",
    hint: "今天要做的事，可直接勾选",
    minW: 296, minH: 216,
    sizes: { S: [296, 216], M: [330, 424], L: [500, 424] },
  },
  notes: {
    label: "便利贴",
    hint: "今天更新的便利贴；拖右缘下缘随你改大小，纸片会自己换列",
    minW: 320, minH: 168,
    sizes: { S: [320, 168], M: [500, 184], L: [500, 368] },
  },
  trend: {
    label: "活动趋势",
    hint: "近 14 天的时间走势",
    minW: 360, minH: 190,
    sizes: { S: [360, 190], M: [500, 304], L: [1000, 304] },
  },
  heatmap: {
    label: "活动热力图",
    hint: "近 4 周的作息轮廓：周一到周日，每个小时平均多忙",
    minW: 352, minH: 188,
    sizes: { S: [352, 188], M: [500, 224], L: [500, 304] },
  },
  timeline: {
    /* exe 里这个槽位是「事项菜单」340×424（`SPECS` 的 Items）；本仓用今日时间线顶上，
     * 尺寸照抄那一格，于是首屏三列的高度关系与 exe 完全一致。 */
    label: "今日时间线",
    hint: "今天每一段计时的时间轴",
    minW: 280, minH: 200,
    sizes: { S: [280, 200], M: [340, 424], L: [500, 424] },
  },
  reminder: {
    /* [本轮 T04] 工具页「活动提醒」分区的卡内形态；窄卡，与 todos 同列宽便于并排 */
    label: "活动提醒",
    hint: "应用 / 分类 / 网站用到一定时长就提醒，到点弹窗",
    minW: 296, minH: 216,
    sizes: { S: [296, 216], M: [330, 304], L: [500, 304] },
  },
};

/** 卡片矩形：全部是设计点，且已吸附。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardCard extends Rect {
  /** 实例标识：加卡 / 复制时由 `nextId` 发号，永不复用。 */
  uid: number;
  kind: CardKind;
  tier: CardTier;
  /** 自定义标题；缺省 = 组件默认名（`DASHBOARD_COPY.cardLabels`）。 */
  title?: string;
  /** 组件参数（v2 的 `options` 原样保留，如计时卡的 `dimension`）。 */
  options?: Record<string, string>;
}

/** v2 时代模块签名里的名字，保留别名免得到处改。 */
export type LayoutCard = BoardCard;

export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  /** 下一个可用 uid；只增不减（删卡后不回收，避免「新卡继承旧卡设置」的错觉）。 */
  nextId: number;
  cards: BoardCard[];
  /** 8px 吸附开关（设置页可关，关掉后拖拽按 1px 精度）。 */
  snap: boolean;
}

export const LAYOUT_VERSION = 3;
/** v3 换新键：v2 的 `x` 是列号，与 v3 的像素混读会把卡片叠到一起。 */
export const LAYOUT_STORAGE_KEY = "patina:dashboard-layout:v3";

export function specOf(kind: CardKind): KindSpec {
  return KIND_SPECS[kind];
}

/** 组件最小尺寸：全局下限与组件下限取大。 */
export function minSizeOf(kind: CardKind): { w: number; h: number } {
  const spec = KIND_SPECS[kind];
  return { w: Math.max(MIN_W, spec.minW), h: Math.max(MIN_H, spec.minH) };
}

export function isCardId(value: unknown): value is CardKind {
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

/** 卡头显示的标题：自定义名优先，留空回到组件默认名。 */
export function displayTitle(card: BoardCard, cardLabels: Record<string, string>): string {
  const custom = card.title?.trim();
  return custom && custom.length > 0 ? custom : cardLabels[card.kind] ?? card.kind;
}
