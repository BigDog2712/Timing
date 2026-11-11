/**
 * [P1 · 0.12.1] 卡片工具条：上移 / 下移 / 换档 / 移除。
 *
 * 为什么塞进 `ModuleShell` 的卡头而不自己画壳：B7 的判据是「`qp-card-head` 全仓只在
 * `ModuleShell.tsx` 出现一次」——第二套壳一出现，四张卡的卡头就会各自漂。
 * 本文件只出**按钮**，容器由壳提供。
 *
 * 交互取舍：P1 只做到「按钮 + 同列拖动」，不做跨列拖拽手柄。理由是换列已经有显式按钮，
 * 而拖拽的落点判定在双列轨道下要先定「插到第几位」，那是 P2 的事。
 */
import { ChevronDown, ChevronUp, Maximize2, Minimize2, X } from "lucide-react";
import type { CardId, CardTier } from "./contract";

interface Props {
  id: CardId;
  tier: CardTier;
  canMoveUp: boolean;
  canMoveDown: boolean;
  label: string;
  onMove: (direction: -1 | 1) => void;
  onTier: (tier: CardTier) => void;
  onRemove: () => void;
}

/** 档位循环：S → M → L → S。两个按钮只表达「更小 / 更大」，不并列三个按钮。 */
const SMALLER: Record<CardTier, CardTier> = { S: "S", M: "S", L: "M" };
const LARGER: Record<CardTier, CardTier> = { S: "M", M: "L", L: "L" };

export default function CardControls({
  id,
  tier,
  canMoveUp,
  canMoveDown,
  label,
  onMove,
  onTier,
  onRemove,
}: Props) {
  return (
    <span className="qp-card-controls" data-card-controls={id}>
      <button
        type="button"
        className="qp-card-control"
        aria-label={`${label} 上移`}
        aria-disabled={!canMoveUp || undefined}
        onClick={canMoveUp ? () => onMove(-1) : undefined}
      >
        <ChevronUp size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="qp-card-control"
        aria-label={`${label} 下移`}
        aria-disabled={!canMoveDown || undefined}
        onClick={canMoveDown ? () => onMove(1) : undefined}
      >
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="qp-card-control"
        aria-label={`${label} 缩小`}
        aria-disabled={tier === "S" || undefined}
        onClick={tier === "S" ? undefined : () => onTier(SMALLER[tier])}
      >
        <Minimize2 size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="qp-card-control"
        aria-label={`${label} 放大`}
        aria-disabled={tier === "L" || undefined}
        onClick={tier === "L" ? undefined : () => onTier(LARGER[tier])}
      >
        <Maximize2 size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="qp-card-control"
        aria-label={`移除 ${label}`}
        onClick={onRemove}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}
