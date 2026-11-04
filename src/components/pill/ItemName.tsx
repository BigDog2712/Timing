/**
 * TickBar — 事项名（1fr 截断，超长保留开头）
 * -----------------------------------------------------------------------------
 * 截断规则（pill-bar.md §1）：超过 11 个中文字符省略号，保留**开头**。
 * 悬停完整名：使用原生 `title`（浏览器 tooltip，零依赖、可访问）。
 * [V0.2.1 · 3/4] 交互口径（用户指定）：
 *   - 左键单击 → 由调用方决定（现状 = 计时中/暂停态唤起**常用事项框**）；
 *   - 右键单击 → 唤起计时事项菜单（ContextMenu）。
 * 兜底：WebView2 在不同输入路径下不一定派发 `contextmenu`，必要时连 `click` 也可能丢，
 * 故 **pointerup 也走同一条打开逻辑**（左键限位移 ≤ 4px 的「真点击」，右键 400ms 去重），
 * 两条路径都到了就用时间戳去重，不会开两次。
 */
import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { NAME_MAX_CHARS } from '../../lib/constants';
import { clientToLayer } from '../../lib/fitBounds';
import { truncateName } from '../../lib/format';
import type { MenuPos } from '../../stores/uiStore';

interface ItemNameProps {
  name: string;
  /** PAUSED 下用 --muted 弱化（pill-bar.md §3.1） */
  muted?: boolean;
  /** [V0.2.1 · 3] 左键点击：快捷添加事项 */
  onActivate?: () => void;
  /** [V0.2.1 · 4] 右键点击：唤起计时事项菜单，坐标为屏幕内的锚点 */
  onMenu?: (pos: MenuPos) => void;
}

export function ItemName({ name, muted = false, onActivate, onMenu }: ItemNameProps) {
  const display = truncateName(name, NAME_MAX_CHARS);
  const isTruncated = display !== name.trim();
  const interactive = typeof onActivate === 'function' || typeof onMenu === 'function';
  const rightUpAt = useRef(0);
  /* [V0.3.9] 左键：pointerup 兜底 + click 去重，理由见文件头注释 */
  const leftDownAt = useRef<{ x: number; y: number } | null>(null);
  const leftActivatedAt = useRef(0);
  /** 判定为「点击」的最大位移（px）：超过就当成拖动，避免拖窗收尾时误开面板 */
  const CLICK_SLOP_PX = 4;

  /** 右键按下/抬起都不往上传：否则 PillBar 会把它当成「结束计时」 */
  const stopRight = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button === 2) e.stopPropagation();
    if (e.button !== 0) return;
    leftDownAt.current = { x: e.clientX, y: e.clientY };
  };

  const openMenuAt = (clientX: number, clientY: number) => {
    /* [ADR-020] 指针是视口坐标、菜单锚点是布局坐标：置层被 translate 过，必须换算 */
    onMenu?.(clientToLayer(clientX, clientY));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button === 2) {
      e.stopPropagation();
      e.preventDefault();
      rightUpAt.current = Date.now();
      openMenuAt(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0 || !onActivate) return;
    const from = leftDownAt.current;
    leftDownAt.current = null;
    if (!from) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP_PX) return;
    leftActivatedAt.current = Date.now();
    onActivate();
  };

  /** click 兜底：pointerup 已经处理过就不重复触发（部分 WebView2 输入路径下只来其一） */
  const handleClick = () => {
    if (!onActivate) return;
    if (Date.now() - leftActivatedAt.current < 400) return;
    leftActivatedAt.current = Date.now();
    onActivate();
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - rightUpAt.current < 400) return;
    openMenuAt(e.clientX, e.clientY);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!onActivate) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <span
      className="pill__name"
      data-muted={muted ? 'true' : 'false'}
      data-interactive={interactive ? 'true' : 'false'}
      title={isTruncated ? name : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      onPointerDown={stopRight}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      {display}
    </span>
  );
}
