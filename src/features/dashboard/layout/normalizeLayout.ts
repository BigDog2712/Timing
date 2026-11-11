/**
 * [P1 · 0.12.1] 布局自愈：**坏数据不许让界面空着**，也不许静默改用户的排布。
 *
 * 判据（任务书 B4）：坏 JSON / `version: 999` / 未知 id / 重复 id / 非法 tier 五种输入，
 * 各自给出「回默认或就地修正 + 是否repair过」的确定结论，且只 warn 一条。
 * 这里全是纯函数 —— 不读 localStorage、不写日志，落盘那层才有副作用（`layoutStore.ts`）。
 */
import {
  DEFAULT_TIER,
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

/** 只能待在列内的卡（有行高令牌）；其余是通栏卡。 */
const ROW_CARDS: readonly CardId[] = ["timer", "items", "apps", "todos"];
/** 只能通栏的卡。 */
const FULL_CARDS: readonly CardId[] = ["notes", "trend", "reminder", "timeline"];

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

/** 按卡的本性把列纠正回来：行内卡不许通栏，通栏卡不许进列。 */
function normalizeColumn(id: CardId, column: unknown): { column: LayoutCard["column"]; repaired: boolean } {
  if (FULL_CARDS.includes(id)) {
    return isCardColumn(column) && column === "full"
      ? { column, repaired: false }
      : { column: "full", repaired: true };
  }
  if (!ROW_CARDS.includes(id)) {
    return { column: "full", repaired: true };
  }
  if (column === "left" || column === "right") return { column, repaired: false };
  return { column: "left", repaired: true };
}

export function normalizeLayout(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") {
    return { layout: cloneDefault(), repaired: true, reason: "not-an-object" };
  }

  const candidate = raw as { version?: unknown; cards?: unknown };
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
    const record = entry as { id?: unknown; column?: unknown; tier?: unknown; options?: unknown };
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
    cards.push({
      id: record.id,
      column: column.column,
      tier: tier as LayoutCard["tier"],
      ...(options ? { options } : {}),
    });
  }

  if (cards.length === 0) {
    return { layout: cloneDefault(), repaired: true, reason: "empty-cards" };
  }

  return { layout: { version: LAYOUT_VERSION, cards }, repaired, reason };
}
