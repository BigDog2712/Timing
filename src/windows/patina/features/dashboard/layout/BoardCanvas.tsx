/**
 * [v3.1] 画布：**固定倍率 + 可滚**。
 *
 * 上一版把整块板缩到刚好铺满窗口（`min(宽/1250, 高/820)`），代价是两件事：
 *   · 窗口一变，卡片跟着变大变小 —— 想看清细节反而没办法；
 *   · 内容永远刚好铺满，滚轮永远没东西可滚，用户以为"主界面滚不动"。
 *
 * 现在倍率归用户（Ctrl + 滚轮，见 `useBoardZoom`），画布按倍率长出真实尺寸，
 * 超出的部分由滚动容器吃掉：上下滚、Shift 横向滚，卡片大小与窗口大小彻底解耦。
 *
 * 舞台（`.qp-board-stage`）只负责"缩放后的占位"，画布本体仍是 1250×820 的设计点
 * 坐标系 + `transform: scale()`（左上原点）。这样卡片的 x/y 永远不会被重排。
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { BOARD_H, BOARD_W, type BoardCard, type DashboardLayout } from "./contract";
import { contentHeight } from "./geometry";
import { useBoardZoom } from "./useBoardZoom";
import { useWindowDragGesture } from "../../../platform/desktop/useWindowDragGesture.ts";

interface Props {
  layout: DashboardLayout;
  renderCard: (card: BoardCard, zoom: number) => ReactNode;
  /** 没有卡片时画一句什么 */
  emptyText: string;
  hintText: string;
  /** 点板上空白处能拖动窗口（主界面为 true；设置页里的预览不给） */
  dragWindowOnBackdrop?: boolean;
}

export default function BoardCanvas({
  layout,
  renderCard,
  emptyText,
  hintText,
  dragWindowOnBackdrop = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { zoom, adjusting } = useBoardZoom(hostRef);
  const windowDrag = useWindowDragGesture();
  const height = Math.max(BOARD_H, contentHeight(layout.cards));

  /* [0.13 · 1.2「无法返回」] 空板**不挂**拖窗：一块空板上处处是空白，用户点一下再拖
   * 就把窗推出屏幕，而窗被推走之后标题栏也不在了 —— 表现和「回不来」一模一样。
   * 只要板上有卡，卡本身就不是拖窗热区（判据在 `BoardCardFrame` 的 ①②③），
   * 空白处拖窗反而是无边框窗的必要手感。 */
  const windowDragEnabled = dragWindowOnBackdrop && layout.cards.length > 0;

  /* 只有"点在自己身上"才算空白：卡片、工具条、提示句都不算。
   * 判据用 currentTarget + 两个容器类名，不靠 `closest`：画布是绝对定位的
   * 定尺寸盒子，命中的元素只可能是这三者之一。 */
  const handleBackdropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!windowDragEnabled) return;
    const target = event.target as Element | null;
    const onBackdrop = target === event.currentTarget
      || target?.classList.contains("qp-board-stage")
      || target?.classList.contains("qp-board-canvas");
    if (!onBackdrop) return;
    windowDrag.onPointerDown(event);
  };

  return (
    <>
      <div
        className="qp-board-scroll"
        ref={hostRef}
        data-board-zoom={zoom}
        onPointerDown={handleBackdropPointerDown}
        onClickCapture={windowDragEnabled ? windowDrag.onClickCapture : undefined}
      >
        <div className="qp-board-stage" style={{ width: BOARD_W * zoom, height: height * zoom }}>
          <div
            className="qp-board-canvas"
            style={{ width: BOARD_W, height, transform: `scale(${zoom})` }}
            aria-describedby="qp-board-hint"
          >
            {layout.cards.map((card) => renderCard(card, zoom))}
            {layout.cards.length === 0 ? (
              <p className="qp-board-empty">{emptyText}</p>
            ) : null}
          </div>
        </div>
        <p id="qp-board-hint" className="qp-board-hint">{hintText}</p>
      </div>
      {/* 缩放反馈：只在动手那 900ms 里出现，静息不占视觉 */}
      {adjusting ? (
        <span className="qp-board-zoom" aria-hidden="true">{Math.round(zoom * 100)}%</span>
      ) : null}
    </>
  );
}
