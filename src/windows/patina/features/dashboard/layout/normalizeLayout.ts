/**
 * [v3] 布局自愈：**坏数据不许让界面空着**，也不许静默把用户的卡丢掉。
 *
 * 判据（每条都给出确定结论，`reason` 只记第一条，日志一条就够）：
 *   · 不是对象 / 版本未知        → 回出厂布局
 *   · 版本 2（网格）             → **迁移**：按 dense 流式重放成像素矩形，卡一张不丢
 *   · uid 重复 / 缺失            → 重新发号（保留位置）
 *   · 未知 kind                  → 丢这一张（留着渲染不出来，反而是空槽）
 *   · x/y/w/h 非法或越界         → 用 `clampRect` 修到合法（吸附 + 最小尺寸 + 不越画布）
 *   · 标题空白                   → 当作没写（回到组件默认名）
 *   · 一张卡都不剩               → 回出厂布局
 *
 * 纯函数 —— 不读 localStorage、不打日志，落盘在 `layoutStore.ts`。
 */
import {
  BOARD_W,
  isCardId,
  isCardTier,
  LAYOUT_VERSION,
  sanitizeOptions,
  DEFAULT_TIER,
  type BoardCard,
  type DashboardLayout,
} from "./contract";
import { cloneDefaultLayout, cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { clampRect, firstOverlap } from "./geometry";

export interface NormalizeResult {
  layout: DashboardLayout;
  /** 与输入不同（= 需要回写，避免每次启动都自愈一遍）。 */
  repaired: boolean;
  reason: string | null;
}

/* v2 网格的换算常量：4 列、列宽 251、行高 264、间距 16（与 old defaultLayout 同源） */
const GRID_COLS = 4;
const GRID_COL_W = 251;
const GRID_ROW_H = 264;
const GRID_GAP = 16;

function gridRect(col: number, row: number, span: number, rows: number) {
  return {
    x: col * (GRID_COL_W + GRID_GAP),
    y: row * (GRID_ROW_H + GRID_GAP),
    w: span * GRID_COL_W + (span - 1) * GRID_GAP,
    h: rows * GRID_ROW_H + (rows - 1) * GRID_GAP,
  };
}

/**
 * v2 → v3 迁移：把「列 + 跨列 + 占行」按 `dense` 流式的真实落位重放成像素矩形。
 *
 * 为什么不在 normalize 里只做「x×267」：v2 **不存 y**，行序是渲染端按流式补位算出来的。
 * 只换 x 会让 items / todos / notes 全部叠在第一行。这里重放一遍 dense 网格：
 * 每张卡找「最上面、最靠左」且 `w×h` 全空的格子，然后换成矩形。
 */
function migrateFromGrid(rawCards: unknown[]): BoardCard[] {
  const taken: boolean[][] = [];
  const cards: BoardCard[] = [];
  let uid = 1;

  const fits = (row: number, col: number, span: number, rows: number) => {
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + span; c += 1) {
        if (taken[r]?.[c]) return false;
      }
    }
    return true;
  };
  const occupy = (row: number, col: number, span: number, rows: number) => {
    for (let r = row; r < row + rows; r += 1) {
      taken[r] = taken[r] ?? [];
      for (let c = col; c < col + span; c += 1) taken[r][c] = true;
    }
  };

  for (const entry of rawCards) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; x?: unknown; w?: unknown; h?: unknown; tier?: unknown; title?: unknown; options?: unknown };
    if (!isCardId(record.id)) continue;

    const span = Math.min(GRID_COLS, Math.max(1, Math.round(Number(record.w) || 1)));
    const rows = Math.min(4, Math.max(1, Math.round(Number(record.h) || 1)));
    const wantX = Math.min(GRID_COLS - span, Math.max(0, Math.round(Number(record.x) || 0)));

    let row = 0;
    let col = 0;
    search: for (let r = 0; r < 200; r += 1) {
      for (let c = r === 0 ? wantX : 0; c <= GRID_COLS - span; c += 1) {
        if (fits(r, c, span, rows)) {
          row = r;
          col = c;
          break search;
        }
      }
    }
    occupy(row, col, span, rows);

    const title = typeof record.title === "string" ? record.title.trim().slice(0, 24) : "";
    cards.push({
      uid: uid++,
      kind: record.id,
      tier: isCardTier(record.tier) ? record.tier : DEFAULT_TIER,
      ...gridRect(col, row, span, rows),
      ...(title ? { title } : {}),
      ...(sanitizeOptions(record.options) ? { options: sanitizeOptions(record.options) } : {}),
    });
  }
  return cards;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultResult(reason: string, fallback: DashboardLayout): NormalizeResult {
  return { layout: cloneLayout(fallback), repaired: true, reason };
}

/**
 * @param fallback 「坏数据 / 一张卡都不剩」时回落到哪一版。
 *   默认是出厂布局；`layoutStore.loadLayout` 会把它换成**主人保存的默认布局**——
 *   归一化本身仍然不读存储（纯函数），由调用方把那条偏好递进来。
 */
export function normalizeLayout(
  raw: unknown,
  fallback: DashboardLayout = cloneDefaultLayout(),
): NormalizeResult {
  if (!raw || typeof raw !== "object") return defaultResult("not-an-object", fallback);

  const candidate = raw as { version?: unknown; cards?: unknown; nextId?: unknown; snap?: unknown };
  if (!Array.isArray(candidate.cards)) return defaultResult("cards-not-array", fallback);

  let repaired = false;
  let reason: string | null = null;
  const note = (why: string) => {
    repaired = true;
    reason = reason ?? why;
  };

  /* v2：网格数据。迁移本身算一次修复（要回写成 v3，否则下次启动又迁一遍）。 */
  let incoming: unknown[] = candidate.cards;
  if (candidate.version === 2) {
    note("migrated-from-v2");
    incoming = migrateFromGrid(candidate.cards);
  } else if (candidate.version !== LAYOUT_VERSION) {
    return defaultResult("version-mismatch", fallback);
  }

  const used = new Set<number>();
  let nextId = 1;
  const cards: BoardCard[] = [];

  for (const entry of incoming) {
    if (!entry || typeof entry !== "object") {
      note("card-not-object");
      continue;
    }
    const record = entry as {
      uid?: unknown; kind?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown;
      tier?: unknown; title?: unknown; options?: unknown;
    };
    if (!isCardId(record.kind)) {
      note("unknown-card-kind");
      continue;
    }

    const rawUid = Math.round(num(record.uid, 0));
    let uid = rawUid > 0 && !used.has(rawUid) ? rawUid : 0;
    if (uid === 0) {
      uid = nextId;
      if (rawUid > 0) note("duplicate-or-illegal-uid");
    }
    used.add(uid);
    nextId = Math.max(nextId, uid + 1);

    /* 读入时**不吸附**：出厂布局的半宽 518 本身不是 8 的倍数（518 / 8 = 64.75），
     * 吸附会把默认布局悄悄改成 520，B1「默认逐像素不变」当场失效。
     * 吸附只在用户拖动/缩放时发生（`boardStore.moveTo` 传 `layout.snap`）。 */
    const rect = clampRect(record.kind, {
      x: num(record.x, 0),
      y: num(record.y, 0),
      w: num(record.w, 518),
      h: num(record.h, 264),
    }, false);
    if (rect.x !== record.x || rect.y !== record.y || rect.w !== record.w || rect.h !== record.h) {
      note("illegal-rect");
    }

    const options = sanitizeOptions(record.options);
    const title = sanitizeTitle(record.title);

    cards.push({
      uid,
      kind: record.kind,
      tier: isCardTier(record.tier) ? record.tier : DEFAULT_TIER,
      ...rect,
      ...(title ? { title } : {}),
      ...(options ? { options } : {}),
    });
  }

  if (cards.length === 0) return defaultResult("empty-cards", fallback);

  /* 落地前再对撞一次：两张卡完全重叠是「有数据但看不见」最难查的形态
   * （用户以为卡被删了）。只提示不重排——重排等于替用户做了决定。 */
  const clash = firstOverlap(cards);
  if (clash) note("cards-overlap");

  const declaredNext = Math.round(num(candidate.nextId, 0));
  const snap = candidate.snap === false ? false : true;
  if (candidate.snap !== undefined && candidate.snap !== snap) note("illegal-snap");
  if (declaredNext < nextId) note("illegal-next-id");

  return {
    layout: {
      version: LAYOUT_VERSION,
      nextId: Math.max(nextId, declaredNext, 1),
      cards,
      snap,
    },
    repaired,
    reason,
  };
}

/** 出厂布局的 uid 基准（测试与 add 的落点判定共用）。 */
export const DEFAULT_NEXT_ID = DEFAULT_LAYOUT.nextId;
/** 画布宽度导出给测试断言（避免测试里写 1052 这个裸数）。 */
export const BOARD_WIDTH = BOARD_W;
