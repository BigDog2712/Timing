/**
 * Timing — 浮层菜单的贴边定位（[0.12.3] 从 `ItemsPrefsMenu` 抽出）
 * -----------------------------------------------------------------------------
 * 菜单以锚点为左上角，但不许出工作区：左/上贴边，右/下按工作区反推，返回的
 * `maxHeight` 给列表内部滚动。抽出来只为给事项管理卡腾单文件行数（300 行硬限）。
 */
import { fitBounds } from './fitBounds';
import type { MenuPos } from '../stores/uiStore';

export interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export function placeMenu(
  anchor: MenuPos,
  width: number,
  minHeight: number,
  edge = 4,
): MenuPlacement {
  const viewport = fitBounds();
  const leftEdge = viewport.x + edge;
  const topEdge = viewport.y + edge;
  const left = Math.min(
    Math.max(anchor.x, leftEdge),
    Math.max(leftEdge, viewport.x + viewport.w - width - edge),
  );
  const top = Math.min(
    Math.max(anchor.y, topEdge),
    Math.max(topEdge, viewport.y + viewport.h - minHeight - edge),
  );
  return { left, top, maxHeight: Math.max(minHeight, viewport.y + viewport.h - top - edge) };
}