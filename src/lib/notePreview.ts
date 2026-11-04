/**
 * Timing — 便利贴预览卡的几何（V0.3.9，纯函数，便于单测）
 * -----------------------------------------------------------------------------
 * 卡片画在事项窗左侧的透明区里（窗口为它加宽了 240px，见 `TODOS_PREVIEW_INSET`）。
 * 竖直方向贴住被悬停的那一行，再按视口钳制：行靠近底部时卡片往上收，
 * 不会顶到窗外（WebView 只画窗口内，出界的部分会被裁掉）。
 */
export const NOTE_PREVIEW_W = 224;
/** 卡片最大高度：正文再多也不撑满整列，超出滚轮滚动 */
export const NOTE_PREVIEW_MAX_H = 264;
/** 与窗口左缘 / 上下缘的留白 */
const EDGE_GAP = 8;

export interface NotePreviewBox {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function notePreviewBox(anchorTop: number, viewportH: number): NotePreviewBox {
  const wanted = anchorTop - EDGE_GAP / 2;
  const maxTop = Math.max(EDGE_GAP, viewportH - NOTE_PREVIEW_MAX_H - EDGE_GAP);
  return {
    left: EDGE_GAP,
    top: Math.round(Math.max(EDGE_GAP, Math.min(wanted, maxTop))),
    width: NOTE_PREVIEW_W,
    maxHeight: NOTE_PREVIEW_MAX_H,
  };
}
