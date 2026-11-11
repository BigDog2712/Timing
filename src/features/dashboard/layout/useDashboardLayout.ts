/**
 * [P1 · 0.12.1] 布局 hook：状态 + 四类动作 + 落盘。
 *
 * 纪律两条：
 * 1. **改完立刻落盘**（同一 tick 内写，不做防抖）——布局是用户手动动作，频率极低；
 *    防抖只会在「改完就关窗」时丢掉最后一次，而那次恰恰是他唯一一次调整。
 * 2. **单实例**（任务书口径 ⑥）：加卡时若该卡已在板上，什么都不做（返回 false），
 *    不做「再摆一张」——同一份数据在一屏里摆两张，读的人会以为是两份。
 */
import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_TIER,
  type CardColumn,
  type CardId,
  type CardTier,
  type DashboardLayout,
  type LayoutCard,
} from "./contract";
import { loadLayout, resetLayout, saveLayout } from "./layoutStore";

export interface DashboardLayoutController {
  layout: DashboardLayout;
  left: LayoutCard[];
  right: LayoutCard[];
  full: LayoutCard[];
  has: (id: CardId) => boolean;
  addCard: (id: CardId, column?: CardColumn) => boolean;
  removeCard: (id: CardId) => void;
  moveCard: (id: CardId, direction: -1 | 1) => void;
  setCardColumn: (id: CardId, column: CardColumn) => void;
  setCardTier: (id: CardId, tier: CardTier) => void;
  reset: () => void;
}

function commit(next: DashboardLayout): DashboardLayout {
  saveLayout(next);
  return next;
}

export function useDashboardLayout(): DashboardLayoutController {
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout().layout);

  const has = useCallback((id: CardId) => layout.cards.some((card) => card.id === id), [layout]);

  const addCard = useCallback((id: CardId, column: CardColumn = "right") => {
    const added = { id, column, tier: DEFAULT_TIER } satisfies LayoutCard;
    let accepted = false;
    setLayout((current) => {
      if (current.cards.some((card) => card.id === id)) {
        accepted = false;
        return current;
      }
      accepted = true;
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
      /* 只在**同列内**换序：跨列换序会顺手改变列归属，用户点的是「上移一格」。 */
      const column = current.cards[index].column;
      const siblings = current.cards
        .map((card, at) => ({ card, at }))
        .filter((entry) => entry.card.column === column);
      const position = siblings.findIndex((entry) => entry.at === index);
      const target = position + direction;
      if (target < 0 || target >= siblings.length) return current;
      const cards = [...current.cards];
      const [moved] = cards.splice(index, 1);
      cards.splice(siblings[target].at, 0, moved);
      return commit({ ...current, cards });
    });
  }, []);

  const setCardColumn = useCallback((id: CardId, column: CardColumn) => {
    setLayout((current) => commit({
      ...current,
      cards: current.cards.map((card) => (card.id === id ? { ...card, column } : card)),
    }));
  }, []);

  const setCardTier = useCallback((id: CardId, tier: CardTier) => {
    setLayout((current) => commit({
      ...current,
      cards: current.cards.map((card) => (card.id === id ? { ...card, tier } : card)),
    }));
  }, []);

  const reset = useCallback(() => {
    resetLayout();
    /* 清键后再读：`loadLayout` 的「首次运行」分支给的是出厂布局，不写盘。 */
    setLayout(loadLayout().layout);
  }, []);

  const left = useMemo(() => layout.cards.filter((card) => card.column === "left"), [layout]);
  const right = useMemo(() => layout.cards.filter((card) => card.column === "right"), [layout]);
  const full = useMemo(() => layout.cards.filter((card) => card.column === "full"), [layout]);

  return { layout, left, right, full, has, addCard, removeCard, moveCard, setCardColumn, setCardTier, reset };
}
