/**
 * [v2 · 0.12.1末] 卡槽：卡在网格里占的那一格。所有卡共用。
 *
 * v2 起没有「列内/通栏」之分：网格是 4 列，卡用 `grid-column: x+1 / span w` 定位、
 * `grid-row: span h` 定高。槽写 inline `gridColumn` / `gridRow`，高度由 CSS 的
 * `data-h`（占行数）× 基准行高令牌给出。
 *
 * 宽度手柄（右缘）保留：它改的是卡的 `w`（占宽），吸附到整数格。
 */
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { COLS, type LayoutCard } from "./contract.ts";

interface Props {
  card: LayoutCard;
  onWidthDown?: (event: PointerEvent<HTMLElement>) => void;
  /** [拖拽排序] 这张卡是否正在被拖（加 `data-dragging`，grip 拉满 + 阴影抬升）。 */
  dragging?: boolean;
  children: ReactNode;
}

export default function CardSlot({ card, onWidthDown, dragging = false, children }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const style: CSSProperties = {
    gridColumn: `${card.x + 1} / span ${card.w}`,
    gridRow: `span ${card.h}`,
  };

  return (
    <div
      className="qp-card-slot"
      data-card={card.id}
      data-tier={card.tier}
      data-h={card.h}
      data-w={card.w}
      data-dragging={dragging || undefined}
      style={style}
    >
      {children}
      <span
        className="qp-card-width"
        role="separator"
        aria-orientation="vertical"
        aria-label={copy.resizeWidth(copy.cardLabels[card.id] ?? card.id)}
        aria-valuenow={card.w}
        aria-valuemin={1}
        aria-valuemax={COLS}
        tabIndex={0}
        onPointerDown={onWidthDown}
      />
    </div>
  );
}
