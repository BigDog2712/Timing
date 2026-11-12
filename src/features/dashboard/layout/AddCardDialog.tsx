/**
 * [v3] 加卡弹层：列出**全部组件**（不再过滤「已在板上」的），点一下加一张。
 *
 * 与 v2 的两处不同，都是自由摆位带来的：
 *   ① **不去重**：同一种组件可以放多张（两张待办、一张通栏趋势 + 一张半宽趋势都是合法排布），
 *      所以列表不灰掉已存在的项，只在右侧显示「板上 N 张」；
 *   ② **不自动关闭**：加完一张往往还想再加一张，关掉重开是多余动作。关闭由用户点 / Esc。
 *
 * 落点由 `boardStore.add` 决定（第一块空地），这一层不猜坐标。
 */
import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import type { BoardCopy } from "./boardCopy";
import { CARD_IDS, KIND_SPECS, type CardKind } from "./contract";

interface Props {
  copy: BoardCopy;
  countOf: (kind: CardKind) => number;
  onAdd: (kind: CardKind) => void;
  onClose: () => void;
}

export default function AddCardDialog({ copy, countOf, onAdd, onClose }: Props) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="qp-add-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qp-add-card-title"
      onPointerDown={(event) => {
        /* 点遮罩关闭；点面板内部不动。用 pointerdown 而不是 click：
         * 拖拽用的是 pointer 事件，click 在拖动结束后可能不触发。 */
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className="qp-add-card__panel" ref={panelRef}>
        <h2 id="qp-add-card-title" className="qp-add-card__title">{copy.addTitle}</h2>
        <p className="qp-add-card__empty">{copy.addNote}</p>
        <ul className="qp-add-card__list">
          {CARD_IDS.map((kind, index) => {
            const spec = KIND_SPECS[kind];
            const count = countOf(kind);
            return (
              <li key={kind}>
                <button
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="qp-add-card__item"
                  onClick={() => onAdd(kind)}
                >
                  <Plus size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="qp-add-card__name">{spec.label}</span>
                  <span className="qp-add-card__hint">{spec.hint}</span>
                  <span className="qp-add-card__count">{copy.onBoard(count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="qp-control" onClick={onClose}>{copy.close}</button>
      </div>
    </div>
  );
}
