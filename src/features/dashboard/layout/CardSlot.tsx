/**
 * [单独宽度 · 0.12.1] 卡槽：卡在板上**占的那一格**。列内卡与通栏卡共用这一个组件。
 *
 * 为什么要多这一层（以前列内卡直接是网格项）：
 * · 宽度要按「自己那一列的四分之几」算 → 卡必须有一个能写 `grid-column: span N` 的容器；
 * · 高度要跟着卡走、不跟「第几行」走（并排之后一行里有两张卡，行高会互相压）；
 * · 宽度手柄是**卡外**的一条，压在卡与卡的缝里，放进 `.qp-card` 会被 `overflow: hidden` 裁掉。
 *
 * 定高的正本在 CSS（`.qp-card-slot[data-card][data-tier]` → `--qp-slot-h`），
 * 这里只写**用户拖出来的**那一个值 —— inline 才有资格压过令牌。
 */
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { columnSpan, DEFAULT_CARD_WIDTH, MIN_CARD_WIDTH, type LayoutCard } from "./contract.ts";

interface Props {
  card: LayoutCard;
  /** `column` = 列内一格（可拖宽）；`full` = 通栏（整板宽，不出宽度手柄） */
  mode: "column" | "full";
  onWidthDown?: (event: PointerEvent<HTMLElement>) => void;
  children: ReactNode;
}

export default function CardSlot({ card, mode, onWidthDown, children }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const width = card.width ?? DEFAULT_CARD_WIDTH;

  const style: CSSProperties = {};
  if (typeof card.height === "number") style.height = `${card.height}px`;
  if (mode === "column") style.gridColumn = `span ${columnSpan(width)}`;

  return (
    <div
      className={mode === "full" ? "qp-full-slot" : "qp-card-slot"}
      data-card={card.id}
      data-tier={card.tier}
      style={style}
    >
      {children}
      {mode === "column" ? (
        <span
          className="qp-card-width"
          role="separator"
          aria-orientation="vertical"
          aria-label={copy.resizeWidth(copy.cardLabels[card.id] ?? card.id)}
          aria-valuenow={width}
          aria-valuemin={MIN_CARD_WIDTH}
          aria-valuemax={DEFAULT_CARD_WIDTH}
          tabIndex={0}
          onPointerDown={onWidthDown}
        />
      ) : null}
    </div>
  );
}
