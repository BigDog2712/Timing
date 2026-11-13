/**
 * [v3] 组件板的状态与动作：**一个 store，两个消费者**（主界面 + 设置页）。
 *
 * 为什么从 `useState` 换成 zustand：布局现在有两个入口 —— 主界面上直接拖，
 * 设置页里也能改（显隐 / 尺寸档 / 默认布局）。两个页面不同时挂载，靠 props 传不过去；
 * 各自 `useState` 一份会出现「设置里删了卡，回主界面还在」。store 是唯一真相，
 * 落盘仍在 `layoutStore` / `library`（store 只负责内存态 + 编排）。
 *
 * 拖拽期间用 `save=false` **只改内存**：每帧写 localStorage 会把手感拖成卡顿
 * （v2 的 `useCardDrag` 同一条纪律）。松手才 `save=true` 一次。
 *
 * [0.13 · 需求 1.3 / 1.4] 三处结构性变化：
 *   ① **锁定**（`locked`）：独立键（`lockPreference.ts`），不进 `DashboardLayout` ——
 *      放进去要升 `LAYOUT_VERSION`，会触发 `normalizeLayout` 全量自愈去"修"用户排布。
 *      锁定 = **几何锁 + 结构锁**：禁 拖动 / 改尺寸 / 整理 / 加卡 / 删卡 / 复制 / 换档 /
 *      切布局 / 删布局 / 新建布局；**允许** 改卡标题与卡内参数（`setTitle` / `setOption`）。
 *   ② **多布局库**（`library.ts`）：`createLayout` / `switchToLayout` / `removeLayout`。
 *   ③ 删掉 `reset` / `resetToFactory`：工具栏只留三入口，「出厂」变成库里那条内置条目
 *      `factory`（见 `layout/library.ts` 头注释）。
 */
import { create } from "zustand";
import {
  KIND_SPECS,
  SNAP,
  type BoardCard,
  type CardKind,
  type CardTier,
  type DashboardLayout,
  type Rect,
} from "./contract";
import { clampRect, findFreeSpot, tidyCards } from "./geometry";
import { cloneDefaultLayout, cloneLayout } from "./defaultLayout";
import { loadLayout, saveLayout, saveSavedDefault } from "./layoutStore";
import {
  createLayout as createLibraryEntry,
  emptyLibrary,
  FACTORY_LAYOUT_ID,
  loadLibrary,
  removeLayout as removeLibraryEntry,
  resolveLayout,
  saveLibrary,
  type LayoutLibrary,
} from "./library";
import { readLocked, writeLocked } from "./lockPreference";

export interface BoardActions {
  /** 加一张卡：找第一块空地落下，返回新 uid。**同类型可重复加**。锁定时返回 -1（不加）。 */
  add: (kind: CardKind) => number;
  /** 复制一张卡（偏移 16px，压在原卡右下）。没有那张卡 / 锁定时返回 null。 */
  duplicate: (uid: number) => number | null;
  remove: (uid: number) => void;
  /** 点一下就把卡提到最前（数组顺序 = 绘制顺序 = z 序）。锁定时**仍允许**（不改排布）。 */
  raise: (uid: number) => void;
  /** 改矩形。`save=false` 用于拖动中的预览。**锁定时直接早退**（几何锁）。 */
  moveTo: (uid: number, rect: Rect, save?: boolean) => void;
  /** 切尺寸档（只改 w/h，不动 x/y）。锁定时早退（几何锁）。 */
  setTier: (uid: number, tier: CardTier) => void;
  /** 改卡标题：**锁定态仍允许** —— 锁的是几何与结构，不是内容。 */
  setTitle: (uid: number, title: string | null) => void;
  /** 改卡内参数（如计时卡的维度）：**锁定态仍允许**。 */
  setOption: (uid: number, key: string, value: string | null) => void;
  setSnap: (on: boolean) => void;
  /** 两列 + 通栏的紧凑重排（「我把卡拖乱了」的退路）。锁定时早退。 */
  tidy: () => void;
  /** 开 / 关锁定。**这颗动作本身永远可用** —— 否则用户永久解不开锁。 */
  setLocked: (next: boolean) => void;
  /**
   * 把当前排布存成布局库里的一条新布局并设为当前。
   * 空板返回 false（空卡表与坏存档在读取时无法区分，存了就是「切过去一片白」的坑）。
   */
  createLayout: (name: string) => boolean;
  /** 切到某条布局（深拷贝写入当前排布键）。`"factory"` = 出厂排布。锁定时早退。 */
  switchToLayout: (id: string) => void;
  /** 删一条布局；删的是当前那条 → 当前排布回落到出厂。锁定时早退。 */
  removeLayout: (id: string) => void;
  /** 首次进界面时把老「默认布局」键迁移进库（幂等，见 `library.loadLibrary`）。 */
  hydrateLibrary: (migratedName: string) => void;
}

export interface BoardStore extends BoardActions {
  layout: DashboardLayout;
  /** 布局锁定（独立键，见 `lockPreference.ts`） */
  locked: boolean;
  /** 多布局库（`activeId` + `items`；factory 是虚拟条目） */
  library: LayoutLibrary;
  /** 迁移做过了没有（`hydrateLibrary` 的幂等标记，测试可重置） */
  libraryHydrated: boolean;
}

function persist(layout: DashboardLayout) {
  saveLayout(layout);
  return layout;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  layout: loadLayout().layout,
  locked: readLocked(),
  library: emptyLibrary(),
  libraryHydrated: false,

  add: (kind) => {
    if (get().locked) return -1;
    const current = get().layout;
    const size = KIND_SPECS[kind].sizes.M;
    const spot = findFreeSpot(current.cards, kind, { w: size[0], h: size[1] });
    const card: BoardCard = {
      uid: current.nextId,
      kind,
      x: spot.x,
      y: spot.y,
      w: size[0],
      h: size[1],
      tier: "M",
    };
    set({
      layout: persist({
        ...current,
        nextId: current.nextId + 1,
        cards: [...current.cards, card],
      }),
    });
    return card.uid;
  },

  duplicate: (uid) => {
    if (get().locked) return null;
    const current = get().layout;
    const source = current.cards.find((card) => card.uid === uid);
    if (!source) return null;
    const rect = clampRect(source.kind, { ...source, x: source.x + 16, y: source.y + 16 }, false);
    const copy: BoardCard = { ...source, uid: current.nextId, ...rect };
    set({
      layout: persist({
        ...current,
        nextId: current.nextId + 1,
        cards: [...current.cards, copy],
      }),
    });
    return copy.uid;
  },

  remove: (uid) => {
    if (get().locked) return;
    const current = get().layout;
    set({ layout: persist({ ...current, cards: current.cards.filter((card) => card.uid !== uid) }) });
  },

  raise: (uid) => {
    const current = get().layout;
    const at = current.cards.findIndex((card) => card.uid === uid);
    if (at < 0 || at === current.cards.length - 1) return;
    const cards = [...current.cards];
    const [card] = cards.splice(at, 1);
    cards.push(card);
    /* 不落盘：z 序是「我正在看哪张」，不是用户要保存的排布。 */
    set({ layout: { ...current, cards } });
  },

  moveTo: (uid, rect, save = true) => {
    if (get().locked) return;
    const current = get().layout;
    let changed = false;
    const cards = current.cards.map((card) => {
      if (card.uid !== uid) return card;
      const next = clampRect(card.kind, rect, current.snap);
      if (next.x === card.x && next.y === card.y && next.w === card.w && next.h === card.h) return card;
      changed = true;
      return { ...card, ...next };
    });
    if (!changed) return;
    const layout = { ...current, cards };
    set({ layout: save ? persist(layout) : layout });
  },

  setTier: (uid, tier) => {
    if (get().locked) return;
    const current = get().layout;
    const cards = current.cards.map((card) => {
      if (card.uid !== uid) return card;
      const size = KIND_SPECS[card.kind].sizes[tier];
      return { ...card, tier, ...clampRect(card.kind, { ...card, w: size[0], h: size[1] }, current.snap) };
    });
    set({ layout: persist({ ...current, cards }) });
  },

  setTitle: (uid, title) => {
    const current = get().layout;
    const clean = title?.trim().slice(0, 24) ?? "";
    const cards = current.cards.map((card) => {
      if (card.uid !== uid) return card;
      const { title: _drop, ...rest } = card;
      return clean ? { ...rest, title: clean } : rest;
    });
    set({ layout: persist({ ...current, cards }) });
  },

  setOption: (uid, key, value) => {
    const current = get().layout;
    const cards = current.cards.map((card) => {
      if (card.uid !== uid) return card;
      const options = { ...(card.options ?? {}) };
      if (value === null) delete options[key];
      else options[key] = value;
      return Object.keys(options).length > 0 ? { ...card, options } : { ...card, options: undefined };
    });
    set({ layout: persist({ ...current, cards }) });
  },

  setSnap: (on) => {
    const current = get().layout;
    set({ layout: persist({ ...current, snap: on }) });
  },

  tidy: () => {
    if (get().locked) return;
    const current = get().layout;
    set({ layout: persist({ ...current, cards: tidyCards(current.cards) }) });
  },

  setLocked: (next) => {
    writeLocked(next);
    set({ locked: next });
  },

  createLayout: (name) => {
    if (get().locked) return false;
    const current = get().layout;
    if (current.cards.length === 0) return false;
    const result = createLibraryEntry(get().library, name, current, Date.now());
    saveLibrary(result.library);
    /* 同步老「默认布局」键：`loadLayout()` 在「当前排布键坏了」时拿它当落点，
       不同步的话那个落点永远停在迁移前那一版。老键**不删**（同 `layoutStore` 纪律）。 */
    saveSavedDefault(cloneLayout(current));
    set({ library: result.library });
    return true;
  },

  switchToLayout: (id) => {
    if (get().locked) return;
    const current = get().library;
    const known = id === FACTORY_LAYOUT_ID || current.items.some((item) => item.id === id);
    const activeId = known ? id : FACTORY_LAYOUT_ID;
    /* 必须深拷贝（`resolveLayout` 里做的）：否则切过去之后拖卡会把库里的那一份也改掉。 */
    const next = resolveLayout(current, activeId);
    const library: LayoutLibrary = { ...current, activeId };
    saveLayout(next);
    saveLibrary(library);
    set({ layout: next, library });
  },

  removeLayout: (id) => {
    if (get().locked) return;
    if (id === FACTORY_LAYOUT_ID) return;
    const current = get().library;
    const next = removeLibraryEntry(current, id);
    if (next === current) return;
    saveLibrary(next);
    if (current.activeId !== id) {
      set({ library: next });
      return;
    }
    /* 删的是当前布局 → 当前排布回落到**出厂**，不猜「用剩下的最近一条」。 */
    const fallback = cloneDefaultLayout();
    saveLayout(fallback);
    set({ layout: fallback, library: next });
  },

  hydrateLibrary: (migratedName) => {
    if (get().libraryHydrated) return;
    const { library } = loadLibrary({ now: Date.now(), migratedName });
    set({ library, libraryHydrated: true });
  },
}));

/** 非 Hook 读法（测试与「加完卡判断是否落在首屏外」这类一次性查询用）。 */
export function boardSnapshot(): DashboardLayout {
  return useBoardStore.getState().layout;
}

export const BOARD_SNAP = SNAP;
