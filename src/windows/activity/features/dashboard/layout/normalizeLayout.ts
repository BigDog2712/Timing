/**
 * [v3] 布局自愈：**坏数据不许让界面空着**，也不许静默把用户的卡丢掉。
 *
 * 判据（每条都给出确定结论，`reason` 只记第一条，日志一条就够）：
 *   · 不是对象 / 版本未知        → 回出厂布局
 *   · 版本 2（网格）             → **迁移**：按 dense 流式重放成像素矩形，卡一张不丢
 *   · 旧 todos / 作废的 items → 变成一张 `manage`（现役 `timeline` 卡原样保留，见下）
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

/**
 * 0.12.6 起**不再是合法的卡种**、但仍要能从存量布局里读出来的旧 id。
 *
 * 为什么它们必须活到迁移那一步才许被丢：v2/v3 的用户手里可能就摆着待办卡，
 * `CARD_IDS` 一删，`isCardId` 立刻把它判成"不认识的组件"→ 静默吃掉一张卡，
 * 而用户看到的只是"我的待办没了"。所以它先被读进来，再由 `migrateLegacyCards`
 * 变成一张 `manage`（`timeline` 卡本身是现役卡种，收在这里只是为了让迁移能把它当
 * "位置来源"认出来并原样保留 —— 它**不触发**迁移）。
 *
 * `items` 是 0.12.6 中途作废的合并卡种（从未出包，只有开发者本机可能有）：
 * 一并收进来，按 `todos` 同一条路迁成 `timeline`，避免老布局在开发机上被当成未知卡种丢掉。
 */
const LEGACY_ITEM_KINDS: readonly string[] = ["todos", "timeline", "items"];

/** 迁移阶段手里的条目：v3 存下来的裸记录，或 `migrateFromGrid` 刚拼出来的对象。 */
type RawEntry = Record<string, unknown>;

/** 条目声明的卡种；脏数据一律返回空串（交给后面的 `isCardId` 判）。 */
function kindOf(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const kind = (entry as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : "";
}

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
function migrateFromGrid(rawCards: unknown[]): RawEntry[] {
  const taken: boolean[][] = [];
  const cards: RawEntry[] = [];
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
    /* 旧卡种（todos / timeline）在这一步**先当合法**收进来，合并交给下一步 —— 这里丢掉
     * 就等于把用户在 v2 里摆过的待办/时间线直接吞掉，合并卡永远不会有。 */
    if (!isCardId(record.id) && !LEGACY_ITEM_KINDS.includes(String(record.id))) continue;

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

/** `migrateLegacyCards` 的结果：新卡表 + 是否真的命中过旧卡种。 */
export interface LegacyCardMigration {
  cards: unknown[];
  /** 命中（= 需要回写）。`cards.length` 在「只有一张旧卡」时不变，所以不能靠比长度判。 */
  migrated: boolean;
}

/** 排序键必须是确定的三元组，否则同一份布局两次迁移得到的落点可能不同。 */
function byVisualOrder(left: unknown, right: unknown): number {
  const a = left as RawEntry;
  const b = right as RawEntry;
  return num(a.y, 0) - num(b.y, 0)
    || num(a.x, 0) - num(b.x, 0)
    || num(a.uid, 0) - num(b.uid, 0);
}

function rectCard(entry: unknown, uid: number, kind: string): RawEntry {
  const raw = entry as RawEntry;
  return {
    uid,
    kind,
    tier: isCardTier(raw.tier) ? raw.tier : DEFAULT_TIER,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, 0),
    h: num(raw.h, 0),
  };
}

/**
 * [0.12.6] 退休卡种（`todos` / 作废的 `items`）→ **至多一张 `manage`**；
 * 现役的 `timeline` 卡只作为"位置来源"参与，**原样保留**。
 *
 * 五条口径：
 *   ① **身份优先，位置其次**：`timeline` 优先于 `items`、`items` 优先于 `todos`，同类之间
 *      才由 `(y, x, uid)` 定序。为什么不能纯按"视觉第一张"：真实布局里旧待办卡常在左列
 *      `(24, 344)`、时间线卡在第二列 `(380, 344)`，纯视觉序会把**旧待办卡变成时间线卡**、
 *      现役时间线卡退成事项管理卡 —— 身份整个错位，比"位置差 340px"糟得多。
 *   ② **现役时间线卡原样保留**：`title` / `options`（以及将来新增的字段）都不重建、不丢。
 *      来源是 `todos` / `items` 时才走 `rectCard`（旧标题「待办事项」挂到「今日时间线」上
 *      更糟）；事项管理卡一律 `rectCard` —— 它是另一张卡、另一套内容。
 *   ③ **触发只认真正退休的卡种**：`timeline` 是现役卡种（`CARD_IDS` 里有、出厂布局就摆着
 *      一张），单独出现时绝不触发迁移 —— 否则每次读入都命中，`repaired` 恒真、每次都写盘。
 *   ④ **事项管理卡不凭空补**：只有当布局里原本存在 `todos`（或作废的 `items`）时才补一张，
 *      落在它让出的那个矩形上；多余的**退休**卡（`todos` / `items`）一律丢弃（同一份布局里
 *      出现两张 `todos` 本来就是脏数据）。**`timeline` 是例外**：多张是用户自己加的卡
 *      （「加卡」与「复制」都能造出来），原样保留，一张都不许吞。
 *   ⑤ **uid 不许退成 0**：现役时间线卡保留自己原来的号（不参与"取最小"重排）；`rectCard`
 *      那条取命中集合里最小的正 uid，撞号或缺失时退到 `max(整份布局正 uid)+1` 依次递增
 *      —— 0 会在下一次归一化里被当脏数据丢掉，而它恰恰是刚迁出来的那张卡。
 *      `nextId` 由调用方按 `max(uid)+1` 重算，只增不减。
 *
 * `w/h` 小于新卡 `minSize` 时**不在这里夹**：统一交给 `clampRect` 收口（单一职责，
 * 也避免"迁移时夹一次、读入时又夹一次"的两套边界）。幂等：迁完只剩现役 timeline / manage，
 * 第二次扫不到退休卡种。
 */
export function migrateLegacyCards(cards: readonly unknown[]): LegacyCardMigration {
  const hits = cards.filter((entry) => LEGACY_ITEM_KINDS.includes(kindOf(entry)));
  /* timeline 只作为"位置来源"参与；单独出现（= 新出厂布局、正常升级后的常态）时绝不触发迁移。 */
  const retired = hits.filter((entry) => kindOf(entry) !== "timeline");
  if (retired.length === 0) return { cards: cards.slice(), migrated: false };

  const timelines = hits.filter((entry) => kindOf(entry) === "timeline").sort(byVisualOrder);
  const merged = hits.filter((entry) => kindOf(entry) === "items").sort(byVisualOrder);
  const todos = hits.filter((entry) => kindOf(entry) === "todos").sort(byVisualOrder);

  /* 时间线位置：优先真实的时间线卡；只有作废合并卡时沿用它的矩形；再退到待办卡 */
  const timelineSource = timelines[0] ?? merged[0] ?? todos[0];
  /** 现役卡（本来就叫 timeline）→ 原样 push，不重建 */
  const timelineIsLive = timelineSource !== undefined && kindOf(timelineSource) === "timeline";
  const manageSource = todos.find((entry) => entry !== timelineSource)
    ?? merged.find((entry) => entry !== timelineSource)
    ?? null;

  const uidOf = (entry: unknown): number => Math.round(num((entry as RawEntry).uid, 0));
  const usedUids = cards.map(uidOf).filter((uid) => uid > 0);
  /* 命中集合自己的号优先（用户的卡位不改号）；号缺失或重号时退到一个**没被占用**的新号 ——
     退成 0 的话这张卡会在下一次归一化里被当成脏数据丢掉，而它恰恰是刚迁出来的那张。 */
  let nextFree = (usedUids.length > 0 ? Math.max(...usedUids) : 0) + 1;
  const hitUids = hits.map(uidOf).filter((uid) => uid > 0).sort((left, right) => left - right);

  const timelineUid = timelineIsLive
    ? (uidOf(timelineSource) > 0 ? uidOf(timelineSource) : nextFree++)
    : (hitUids[0] ?? nextFree++);
  const manageOwnUid = manageSource === null ? 0 : uidOf(manageSource);
  const manageUid = manageOwnUid > 0 && manageOwnUid !== timelineUid ? manageOwnUid : nextFree++;

  const out: unknown[] = [];
  for (const entry of cards) {
    if (entry === timelineSource) {
      out.push(timelineIsLive ? entry : rectCard(entry, timelineUid, "timeline"));
      continue;
    }
    if (entry === manageSource) {
      out.push(rectCard(entry, manageUid, "manage"));
      continue;
    }
    /* 只丢**退休卡种**：多出来的现役 timeline 卡是用户自己加的（板子本来就允许同种多张），
       一并丢掉等于把他摆好的那张卡吞了 —— 这条和"多余的 todos 是脏数据"不是一回事。 */
    if (kindOf(entry) === "todos" || kindOf(entry) === "items") continue;
    out.push(entry);
  }
  return { cards: out, migrated: true };
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

  /* [0.12.6] 退休卡种（todos / 作废的 items）→ 一张事项管理卡，现役时间线卡原样保留。
   * 顺序固定：**网格迁移之后、`clampRect` 之前**
   * （v2 的卡还没有像素矩形，先迁移就无从取位；夹紧放最后，两种迁移都享受同一套边界）。 */
  const merged = migrateLegacyCards(incoming);
  if (merged.migrated) note("migrated-todos-timeline");
  incoming = merged.cards;

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
