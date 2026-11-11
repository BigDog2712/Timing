/**
 * [v2 · 0.12.1末] 布局 hook：网格状态 + 动作 + 落盘。
 *
 * 纪律两条：
 * 1. **改完立刻落盘**（同一 tick 内写，不做防抖）——布局是用户手动动作，频率极低。
 * 2. **单实例**：加卡时若该卡已在板上，什么都不做（返回 false）。
 *
 * v2 起网格模型：卡用 `x`（起始列）+ `w`（占宽）+ `h`（占行）定位，**没有列归属**。
 * 顺序 = `cards` 数组顺序（流式排布用 `order`），拖拽落点 = 改顺序 + 改 x/w。
 */
import { useCallback, useState } from "react";
import {
  clampH,
  clampW,
  clampX,
  DEFAULT_TIER,
  type CardId,
  type CardTier,
  type DashboardLayout,
  type LayoutCard,
} from "./contract";
import { loadLayout, resetLayout, saveLayout } from "./layoutStore";
import { computeDrop } from "./gridFlow";

export interface DashboardLayoutController {
  layout: DashboardLayout;
  has: (id: CardId) => boolean;
  /** 加卡：默认落到网格尾部（x=0、w=2、h=1）。已在板上返回 false。 */
  addCard: (id: CardId) => boolean;
  removeCard: (id: CardId) => void;
  /** 网格内换序（顺序数组里前后挪一格），供菜单「上移/下移」。 */
  moveCard: (id: CardId, direction: -1 | 1) => void;
  /** 拖拽落位：把卡放到指定顺序位置，并写 x/w。 */
  moveCardTo: (id: CardId, index: number) => void;
  /** [拖拽排序] 把卡拖到目标格（列 col、行 row）：dense 让位 + 吸附 x，落盘。 */
  repositionCard: (id: CardId, col: number, row: number, save?: boolean) => void;
  setCardX: (id: CardId, x: number, save?: boolean) => void;
  setCardW: (id: CardId, w: number, save?: boolean) => void;
  setCardH: (id: CardId, h: number, save?: boolean) => void;
  setCardTier: (id: CardId, tier: CardTier) => void;
  setCardOption: (id: CardId, key: string, value: string | null) => void;
  cardOption: (id: CardId, key: string) => string | null;
  reset: () => void;
}

function commit(next: DashboardLayout): DashboardLayout {
  saveLayout(next);
  return next;
}

export function useDashboardLayout(): DashboardLayoutController {
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout().layout);

  const has = useCallback((id: CardId) => layout.cards.some((card) => card.id === id), [layout]);

  const addCard = useCallback((id: CardId) => {
    let accepted = false;
    setLayout((current) => {
      if (current.cards.some((card) => card.id === id)) {
        accepted = false;
        return current;
      }
      accepted = true;
      const added: LayoutCard = { id, x: 0, w: 2, h: 1, tier: DEFAULT_TIER };
      return commit({ ...current, cards: [...current.cards, added] });
    });
    return accepted;
  }, []);

  const removeCard = useCallback((id: CardId) => {
    setLayout((current) => commit({
      ...current,
      cards: current.cards.filter((card) => card.id !== id),
    }));
  }, []);

  const moveCard = useCallback((id: CardId, direction: -1 | 1) => {
    setLayout((current) => {
      const index = current.cards.findIndex((card) => card.id === id);
      if (index < 0) return current;
      const target = index + direction;
      if (target < 0 || target >= current.cards.length) return current;
      const cards = [...current.cards];
      const [moved] = cards.splice(index, 1);
      cards.splice(target, 0, moved);
      return commit({ ...current, cards });
    });
  }, []);

  const moveCardTo = useCallback((id: CardId, index: number) => {
    setLayout((current) => {
      const from = current.cards.findIndex((card) => card.id === id);
      if (from < 0) return current;
      const cards = [...current.cards];
      const [moved] = cards.splice(from, 1);
      const at = Math.max(0, Math.min(index, cards.length));
      cards.splice(at, 0, moved);
      return commit({ ...current, cards });
    });
  }, []);

  const repositionCard = useCallback((id: CardId, col: number, row: number, save = true) => {
    setLayout((current) => {
      if (!current.cards.some((card) => card.id === id)) return current;
      const { cards } = computeDrop(current.cards, id, col, row);
      const layout = { ...current, cards };
      return save ? commit(layout) : layout;
    });
  }, []);

  const setCardX = useCallback((id: CardId, x: number, save = true) => {
    const next = clampX(x);
    setLayout((current) => {
      const cards = current.cards.map((card) => {
        if (card.id !== id) return card;
        /* x 变了 w 要重夹（x + w <= COLS） */
        const w = clampW(card.w, next);
        return { ...card, x: next, w };
      });
      const layout = { ...current, cards };
      return save ? commit(layout) : layout;
    });
  }, []);

  const setCardW = useCallback((id: CardId, w: number, save = true) => {
    setLayout((current) => {
      const cards = current.cards.map((card) => (card.id === id ? { ...card, w: clampW(w, card.x) } : card));
      const layout = { ...current, cards };
      return save ? commit(layout) : layout;
    });
  }, []);

  const setCardH = useCallback((id: CardId, h: number, save = true) => {
    setLayout((current) => {
      const cards = current.cards.map((card) => (card.id === id ? { ...card, h: clampH(h) } : card));
      const layout = { ...current, cards };
      return save ? commit(layout) : layout;
    });
  }, []);

  const setCardTier = useCallback((id: CardId, tier: CardTier) => {
    setLayout((current) => commit({
      ...current,
      cards: current.cards.map((card) => (card.id === id ? { ...card, tier } : card)),
    }));
  }, []);

  const setCardOption = useCallback((id: CardId, key: string, value: string | null) => {
    setLayout((current) => commit({
      ...current,
      cards: current.cards.map((card) => {
        if (card.id !== id) return card;
        const options = { ...(card.options ?? {}) };
        if (value === null) delete options[key];
        else options[key] = value;
        return Object.keys(options).length > 0
          ? { ...card, options }
          : { id: card.id, x: card.x, w: card.w, h: card.h, tier: card.tier };
      }),
    }));
  }, []);

  const cardOption = useCallback(
    (id: CardId, key: string) => layout.cards.find((card) => card.id === id)?.options?.[key] ?? null,
    [layout],
  );

  const reset = useCallback(() => {
    resetLayout();
    setLayout(loadLayout().layout);
  }, []);

  return {
    layout, has, addCard, removeCard, moveCard, moveCardTo, repositionCard,
    setCardX, setCardW, setCardH, setCardTier, setCardOption, cardOption, reset,
  };
}
