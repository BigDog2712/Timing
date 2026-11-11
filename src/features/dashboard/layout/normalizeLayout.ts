/**
 * [v2 · 0.12.1末] 布局自愈：**坏数据不许让界面空着**，也不许静默改用户的排布。
 *
 * v2 起模型是网格定位（x/w/h），不再有「列」的归属修正。判据：
 *   坏 JSON / `version !== 2` / 未知 id / 重复 id / 非法 tier / 非法 x/w/h
 * 各自给出「回默认或就地修正 + 是否 repair」的确定结论，且只 warn 一条。
 * 纯函数 —— 不读 localStorage、不写日志，落盘在 `layoutStore.ts`。
 */
import {
  clampH,
  clampW,
  clampX,
  DEFAULT_TIER,
  LAYOUT_VERSION,
  sanitizeOptions,
  isCardId,
  isCardTier,
  type CardId,
  type DashboardLayout,
  type LayoutCard,
} from "./contract";
import { DEFAULT_LAYOUT } from "./defaultLayout";

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

export function normalizeLayout(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") {
    return { layout: cloneDefault(), repaired: true, reason: "not-an-object" };
  }

  const candidate = raw as { version?: unknown; cards?: unknown };
  /* v1（version 1）或任何其它版本：直接回默认。旧布局的 `column`/`split` 语义与新网格
   * 不对齐，迁移成本高于收益（主人认可「旧数据丢弃重来」）。 */
  if (candidate.version !== LAYOUT_VERSION) {
    return { layout: cloneDefault(), repaired: true, reason: "version-mismatch" };
  }
  if (!Array.isArray(candidate.cards)) {
    return { layout: cloneDefault(), repaired: true, reason: "cards-not-array" };
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
      id?: unknown; x?: unknown; w?: unknown; h?: unknown; tier?: unknown; options?: unknown;
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

    let x = 0;
    if (typeof record.x === "number" && Number.isFinite(record.x)) {
      x = clampX(record.x);
      if (x !== record.x) note("illegal-x");
    } else if (record.x !== undefined) {
      note("illegal-x");
    }

    let w = 1;
    if (typeof record.w === "number" && Number.isFinite(record.w)) {
      w = clampW(record.w, x);
      if (w !== record.w) note("illegal-w");
    } else if (record.w !== undefined) {
      note("illegal-w");
    }

    let h = 1;
    if (typeof record.h === "number" && Number.isFinite(record.h)) {
      h = clampH(record.h);
      if (h !== record.h) note("illegal-h");
    } else if (record.h !== undefined) {
      note("illegal-h");
    }

    let tier = record.tier;
    if (!isCardTier(tier)) {
      note("illegal-tier");
      tier = DEFAULT_TIER;
    }

    const options = sanitizeOptions(record.options);

    cards.push({
      id: record.id,
      x,
      w,
      h,
      tier: tier as LayoutCard["tier"],
      ...(options ? { options } : {}),
    });
  }

  if (cards.length === 0) {
    return { layout: cloneDefault(), repaired: true, reason: "empty-cards" };
  }

  return {
    layout: { version: LAYOUT_VERSION, cards },
    repaired,
    reason,
  };
}
