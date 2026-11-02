/**
 * TickBar — 时间选择浮层的几何（纯函数）
 * -----------------------------------------------------------------------------
 * 浮层用 `position: fixed` 画在 body 上（`.todos` 有 overflow:hidden + backdrop-filter，
 * 里面放绝对定位会被裁），所以位置必须自己算。
 *
 * 对齐规则：
 *   - 横向**右对齐到卡片**（不是对齐字段）：事项窗只有 492 宽、面板靠右 252，
 *     对齐字段会把 232 宽的浮层顶出窗口；对齐卡片右沿则永远落在面板内。
 *   - 纵向优先贴在字段**下方**，下方放不下就翻到**上方**，两者都不够则夹在视口内。
 */

export interface PickerAnchor {
  top: number;
  bottom: number;
  right: number;
  width: number;
}

export interface PickerBox {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** 浮层默认宽（≈ 面板 252 减两侧 8px 边距） */
export const PICKER_W = 232;

/** 浮层估算高（6 行日历 + 时间行 + 边距）；只用于决定「放下方还是上方」 */
export const PICKER_H = 268;

const GAP = 6;
const EDGE = 8;

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

export function pickerBox(
  anchor: PickerAnchor,
  viewportW: number,
  viewportH: number,
  height: number = PICKER_H,
): PickerBox {
  const width = Math.min(anchor.width, viewportW - EDGE * 2);
  const left = clamp(anchor.right - width, EDGE, viewportW - width - EDGE);

  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const top = below + height <= viewportH - EDGE ? below : Math.max(EDGE, above);

  return {
    left,
    top,
    width,
    maxHeight: Math.max(180, viewportH - top - EDGE),
  };
}
