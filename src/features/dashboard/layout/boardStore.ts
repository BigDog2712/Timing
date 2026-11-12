/**
 * [v3] 组件板的状态与动作：**一个 store，两个消费者**（主界面 + 设置页）。
 *
 * 为什么从 `useState` 换成 zustand：布局现在有两个入口 —— 主界面上直接拖，
 * 设置页里也能改（显隐 / 尺寸档 / 恢复出厂）。两个页面不同时挂载，靠 props 传不过去；
 * 各自 `useState` 一份会出现「设置里删了卡，回主界面还在」。store 是唯一真相，
 * 落盘仍在 `layoutStore`（store 只负责内存态）。
 *
 * 拖拽期间用 `save=false` **只改内存**：每帧写 localStorage 会把手感拖成卡顿
 * （v2 的 `useCardDrag` 同一条纪律）。松手才 `save=true` 一次。
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
import { cloneDefaultLayout } from "./defaultLayout";
import {
  hasSavedDefault,
  loadDefaultLayout,
  loadLayout,
  saveLayout,
  saveSavedDefault,
} from "./layoutStore";

export interface BoardActions {
  /** 加一张卡：找第一块空地落下，返回新 uid。**同类型可重复加**。 */
  add: (kind: CardKind) => number;
  /** 复制一张卡（偏移 16px，压在原卡右下）。没有那张卡返回 null。 */
  duplicate: (uid: number) => number | null;
  remove: (uid: number) => void;
  /** 点一下就把卡提到最前（数组顺序 = 绘制顺序 = z 序）。 */
  raise: (uid: number) => void;
  /** 改矩形。`save=false` 用于拖动中的预览。 */
  moveTo: (uid: number, rect: Rect, save?: boolean) => void;
  /** 切尺寸档（只改 w/h，不动 x/y）。 */
  setTier: (uid: number, tier: CardTier) => void;
  setTitle: (uid: number, title: string | null) => void;
  setOption: (uid: number, key: string, value: string | null) => void;
  setSnap: (on: boolean) => void;
  /** 两列 + 通栏的紧凑重排（「我把卡拖乱了」的退路）。 */
  tidy: () => void;
  /** 把**当前这一版**存为默认布局：此后「恢复默认」回到它。空板返回 false（不存）。 */
  saveAsDefault: () => boolean;
  /** 回到默认布局：存过默认版就回那一版，没存过回出厂。 */
  reset: () => void;
  /** 回到**出厂**布局（exe 首屏那一版）。不动已保存的默认版，随时还能 reset 回去。 */
  resetToFactory: () => void;
}

export interface BoardStore extends BoardActions {
  layout: DashboardLayout;
  /** 主人是否存过自己的默认布局（工具栏据此决定要不要露出「出厂布局」）。 */
  customDefault: boolean;
}

function persist(layout: DashboardLayout) {
  saveLayout(layout);
  return layout;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  layout: loadLayout().layout,
  customDefault: hasSavedDefault(),

  add: (kind) => {
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
    const current = get().layout;
    set({ layout: persist({ ...current, cards: tidyCards(current.cards) }) });
  },

  saveAsDefault: () => {
    const current = get().layout;
    /* 空板不收：存档里「一张卡都没有」与「存档坏了」在读取时无法区分（都回落出厂），
     * 收了等于埋一个「点了恢复默认，板子变白」的坑。守卫放这儿而不是按钮里 —— 设置页也调它。 */
    if (current.cards.length === 0) return false;
    /* 存快照，不存引用：之后接着拖卡，默认版不能跟着变（所以落盘走 `saveSavedDefault`）。 */
    saveSavedDefault(current);
    set({ customDefault: true });
    return true;
  },

  reset: () => {
    /* 不调 `resetLayout` 清当前键：紧接着 `persist` 就把它写回来了，清一次纯属多一次读写。
     * 清键只在「从没存过默认版」时才有意义，而那条路上 `loadDefaultLayout()` 给的就是出厂版。 */
    const layout = loadDefaultLayout();
    /* 顺带跟存储对齐：`customDefault` 是模块加载时读的一次缓存，测试清过 localStorage 后要能自己修正。 */
    set({ layout: persist(layout), customDefault: hasSavedDefault() });
  },

  resetToFactory: () => {
    /* 只换当前排布，**不删**已保存的默认版：手滑点进来还能 reset 回去。 */
    set({ layout: persist(cloneDefaultLayout()) });
  },
}));

/** 非 Hook 读法（测试与「加完卡判断是否落在首屏外」这类一次性查询用）。 */
export function boardSnapshot(): DashboardLayout {
  return useBoardStore.getState().layout;
}

export const BOARD_SNAP = SNAP;
