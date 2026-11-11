/**
 * [P1 · 0.12.1] 布局自愈：**坏数据不许让界面空着**，也不许静默改用户的排布。
 *
 * 判据（任务书 B4）：坏 JSON / `version: 999` / 未知 id / 重复 id / 非法 tier 五种输入，
 * 各自给出「回默认或就地修正 + 是否repair过」的确定结论，且只 warn 一条。
 * 这里全是纯函数 —— 不读 localStorage、不写日志，落盘那层才有副作用（`layoutStore.ts`）。
 */
import {
  clampCardHeight,
  clampCardWidth,
  clampSplit,
  DEFAULT_CARD_WIDTH,
  DEFAULT_TIER,
  FULL_ONLY_CARDS,
  ROW_CARDS,
  sanitizeOptions,
  isCardColumn,
  isCardId,
  isCardTier,
  LAYOUT_VERSION,
  type CardId,
  type DashboardLayout,
  type LayoutCard,
} from "./contract";
import { DEFAULT_LAYOUT } from "./defaultLayout";

/* 两张名单的唯一出处在 `contract`（`Dashboard` 的跨列按钮也要查它）：
 * 这里再抄一份的话，加一张新卡必然只改一处 —— 症状是「点了跨列，刷新又弹回去」。 */

export interface NormalizeResult {
  layout: DashboardLayout;
  /** 是否与输入不同（= 需要回写，避免每次启动都自愈一遍）。 */
  repaired: boolean;
  /** 自愈原因，进日志用；没修就是 null。 */
  reason: string | null;
}

function cloneDefault(): DashboardLayout {
  return { version: LAYOUT_VERSION, cards: DEFAULT_LAYOUT.cards.map((card) => ({ ...card })) };
}

/**
 * 按卡的本性把列纠正回来：通栏卡不许进列。
 *
 * 行内卡**允许** `full`（0.12.1 起支持跨满两列）：它的定高仍在 `--qp-mod-*` 令牌上，
 * 只是从「列内一行」变成「板子上一行」，`.qp-full-slot[data-card=…]` 已给出同一个值。
 * 上一版把行内卡一律压回 `left`，用户点「跨列」后刷新就弹回去了。
 */
function normalizeColumn(id: CardId, column: unknown): { column: LayoutCard["column"]; repaired: boolean } {
  if (FULL_ONLY_CARDS.includes(id)) {
    return isCardColumn(column) && column === "full"
      ? { column, repaired: false }
      : { column: "full", repaired: true };
  }
  if (!ROW_CARDS.includes(id)) {
    return { column: "full", repaired: true };
  }
  if (isCardColumn(column)) return { column, repaired: false };
  return { column: "left", repaired: true };
}

export function normalizeLayout(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") {
    return { layout: cloneDefault(), repaired: true, reason: "not-an-object" };
  }

  const candidate = raw as { version?: unknown; cards?: unknown; split?: unknown };
  if (candidate.version !== LAYOUT_VERSION) {
    return { layout: cloneDefault(), repaired: true, reason: "version-mismatch" };
  }
  if (!Array.isArray(candidate.cards)) {
    return { layout: cloneDefault(), repaired: true, reason: "cards-not-array" };
  }

  /* 列宽比：缺省 = 今天的 44:54（老布局没有这个键，不能因此判"需自愈"）；
   * 坏值夹住并记一次 repair，不丢卡。 */
  let split: number | undefined;
  if (typeof candidate.split === "number" && Number.isFinite(candidate.split)) {
    split = clampSplit(candidate.split);
  }

  const seen = new Set<CardId>();
  const cards: LayoutCard[] = [];
  let repaired = false;
  let reason: string | null = null;
  const note = (why: string) => {
    repaired = true;
    reason = reason ?? why;
  };

  for (const entry of candidate.cards) {
    if (!entry || typeof entry !== "object") {
      note("card-not-object");
      continue;
    }
    const record = entry as {
      id?: unknown; column?: unknown; tier?: unknown; options?: unknown;
      height?: unknown; width?: unknown;
    };
    if (!isCardId(record.id)) {
      note("unknown-card-id");
      continue;
    }
    if (seen.has(record.id)) {
      note("duplicate-card-id");
      continue;
    }
    seen.add(record.id);

    const column = normalizeColumn(record.id, record.column);
    if (column.repaired) note("illegal-column");

    let tier = record.tier;
    if (!isCardTier(tier)) {
      note("illegal-tier");
      tier = DEFAULT_TIER;
    }

    const options = sanitizeOptions(record.options);
    /* 拖出来的高度：只收有限数值，越界就地夹住；坏值当没有（回档位令牌），不删卡。 */
    let height: number | undefined;
    if (typeof record.height === "number" && Number.isFinite(record.height)) {
      height = clampCardHeight(record.height);
    } else if (record.height !== undefined) {
      note("illegal-height");
    }
    /* [单独宽度] 四等分吸附：37 这种值吸到 25 的倍数并记一次 repair；
     * 吸成 100 = 缺省，**不写进布局**（写了会让「恢复默认」永远判为"已自定义"）。 */
    let width: number | undefined;
    if (typeof record.width === "number" && Number.isFinite(record.width)) {
      const snapped = clampCardWidth(record.width);
      if (snapped !== record.width) note("illegal-width");
      if (snapped !== DEFAULT_CARD_WIDTH) width = snapped;
    } else if (record.width !== undefined) {
      note("illegal-width");
    }
    cards.push({
      id: record.id,
      column: column.column,
      tier: tier as LayoutCard["tier"],
      ...(options ? { options } : {}),
      ...(height === undefined ? {} : { height }),
      ...(width === undefined ? {} : { width }),
    });
  }

  if (cards.length === 0) {
    return { layout: cloneDefault(), repaired: true, reason: "empty-cards" };
  }

  return {
    layout: { version: LAYOUT_VERSION, cards, ...(split === undefined ? {} : { split }) },
    repaired,
    reason,
  };
}
