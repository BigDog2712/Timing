/**
 * TickBar — 空状态入口「新建事项」（IDLE 时替代事项名，pill-bar.md §3.2 Empty）
 * -----------------------------------------------------------------------------
 * 左键：`onClick` → 小条内联命名（V0.2.3 起，不再打开完整表单面板）。
 * [V0.2.4 · 1] 右键：与事项名一致，唤起「事项菜单」（此前这格没有右键处理，
 *   idle 下右键事项区什么都不发生，用户误以为事项菜单坏了）。
 *   右键兜底同 ItemName：WebView2 在 CDP/部分输入路径下不派发 `contextmenu`，
 *   故 pointerup(button 2) 也走同一条打开逻辑，并用 400ms 去重。
 */
import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { clientToLayer } from '../../lib/fitBounds';
import type { MenuPos } from '../../stores/uiStore';

interface NewItemEntryProps {
  onClick: () => void;
  /** [V0.2.4 · 1] 右键：唤起事项菜单，坐标为屏幕内的锚点 */
  onMenu?: (pos: MenuPos) => void;
}

export function NewItemEntry({ onClick, onMenu }: NewItemEntryProps) {
  const rightUpAt = useRef(0);

  /** 右键按下/抬起都不往上传：否则 PillBar 会把它当成「结束计时」 */
  const stopRight = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button === 2) e.stopPropagation();
  };

  const openMenuAt = (clientX: number, clientY: number) => {
    /* [ADR-020] 指针是视口坐标、菜单锚点是布局坐标：置层被 translate 过，必须换算 */
    onMenu?.(clientToLayer(clientX, clientY));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 2 || !onMenu) return;
    e.stopPropagation();
    e.preventDefault();
    rightUpAt.current = Date.now();
    openMenuAt(e.clientX, e.clientY);
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!onMenu) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - rightUpAt.current < 400) return;
    openMenuAt(e.clientX, e.clientY);
  };

  return (
    <button
      type="button"
      className="pill__empty"
      onClick={onClick}
      onPointerDown={stopRight}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      aria-label="新建事项并开始计时（右键打开事项菜单）"
    >
      <span>新建事项</span>
    </button>
  );
}
