/**
 * [v3] 一张卡在画布上的框：**定位 + 三种抓取 + 键盘调整**。
 *
 * 框只做几何，不知道卡里画什么（内容由 `DashboardCards.buildCard` 给）。
 * 一条硬约束：框内的**按钮/输入框不许触发拖动**——`⋯`、勾选框、待办输入框都在卡里，
 * 误判的表现是「点勾选没反应，卡被拖走了」。判据写在 `onPointerDown` 里，顺序是
 * 「先认手柄、再认交互元素、最后才认卡头」。
 *
 * 键盘：三根手柄都能 Tab 到，↑/↓/←/→ 各走 8px（= 一次吸附），Shift 加倍。
 * 这不是锦上添花——自由摆位一旦只有鼠标一条路，键盘用户就再也调不动布局。
 */
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { BoardCopy } from "./boardCopy";
import { SNAP, type BoardCard, type Rect } from "./contract";
import { BoardInstanceContext } from "./instanceContext";

export type DragMode = "move" | "e" | "s" | "se";

interface Props {
  card: BoardCard;
  label: string;
  copy: BoardCopy;
  dragging: boolean;
  onBegin: (event: ReactPointerEvent<HTMLElement>, rect: Rect, mode: DragMode) => void;
  onNudge: (rect: Rect) => void;
  children: ReactNode;
}

export default function BoardCardFrame({
  card, label, copy, dragging, onBegin, onNudge, children,
}: Props) {
  const rect: Rect = { x: card.x, y: card.y, w: card.w, h: card.h };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    /* ① 手柄自己接管（三根手柄的 onPointerDown 已经把事件停在这里） */
    if (target.closest("[data-resize]")) return;
    /* ② 卡里的交互元素：点它们不是拖卡 */
    if (target.closest("button, a, input, textarea, select, [role='switch'], [data-no-drag]")) return;
    /* ③ 只有卡头是抓取热区（正文里要能选中文字、点行） */
    if (!target.closest(".qp-card-head, .qp-notes-head, .qp-board-grab")) return;
    onBegin(event, rect, "move");
  };

  const nudgeKeys = (event: ReactKeyboardEvent<HTMLElement>, mode: DragMode) => {
    const step = event.shiftKey ? SNAP * 4 : SNAP;
    const next: Rect = { ...rect };
    const left = event.key === "ArrowLeft";
    const right = event.key === "ArrowRight";
    const up = event.key === "ArrowUp";
    const down = event.key === "ArrowDown";
    if (!left && !right && !up && !down) return;
    event.preventDefault();
    if (mode === "e" || mode === "se") {
      if (left) next.w -= step;
      if (right) next.w += step;
    }
    if (mode === "s" || mode === "se") {
      if (up) next.h -= step;
      if (down) next.h += step;
    }
    if (mode === "move") {
      if (left) next.x -= step;
      if (right) next.x += step;
      if (up) next.y -= step;
      if (down) next.y += step;
    }
    onNudge(next);
  };

  const handle = (mode: Exclude<DragMode, "move">, className: string, labelText: string, orientation: "horizontal" | "vertical") => (
    <span
      className={`qp-board-handle ${className}`}
      data-resize={mode}
      role="separator"
      aria-orientation={orientation}
      aria-label={labelText}
      tabIndex={0}
      onPointerDown={(event) => {
        event.stopPropagation();
        onBegin(event, rect, mode);
      }}
      onKeyDown={(event) => nudgeKeys(event, mode)}
    />
  );

  return (
    <div
      className="qp-board-card"
      data-board-card={card.uid}
      data-kind={card.kind}
      data-dragging={dragging || undefined}
      role="group"
      aria-label={label}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
      onPointerDown={onPointerDown}
    >
      <BoardInstanceContext.Provider value={card.uid}>{children}</BoardInstanceContext.Provider>
      {handle("e", "qp-board-handle-e", copy.resizeWidth(label), "vertical")}
      {handle("s", "qp-board-handle-s", copy.resizeHeight(label), "horizontal")}
      {handle("se", "qp-board-handle-se", copy.resizeBoth(label), "horizontal")}
    </div>
  );
}
