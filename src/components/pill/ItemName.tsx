/**
 * TickBar — 事项名（1fr 截断，超长保留开头）
 * -----------------------------------------------------------------------------
 * 截断规则（pill-bar.md §1）：超过 11 个中文字符省略号，保留**开头**。
 * 悬停完整名：使用原生 `title`（浏览器 tooltip，零依赖、可访问）。
 * [V0.2.1 · 3/4] 交互口径（用户指定）：
 *   - 左键单击 → 快捷添加事项（直接落到输入框，不再先弹「常用事项」菜单）；
 *   - 右键单击 → 唤起计时事项菜单（ContextMenu）。
 * 右键兜底：WebView2 在 CDP 注入的右键下不一定派发 `contextmenu`，故 pointerup(button 2)
 * 也走同一条打开逻辑，并用 400ms 去重防止两条路径重复开两次菜单。
 */
import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { NAME_MAX_CHARS } from '../../lib/constants';
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

  /** 右键按下/抬起都不往上传：否则 PillBar 会把它当成「结束计时」 */
  const stopRight = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button === 2) e.stopPropagation();
  };

  const openMenuAt = (clientX: number, clientY: number) => {
    onMenu?.({ x: clientX, y: clientY });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 2) return;
    e.stopPropagation();
    e.preventDefault();
    rightUpAt.current = Date.now();
    openMenuAt(e.clientX, e.clientY);
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
      onClick={onActivate}
      onKeyDown={interactive ? handleKeyDown : undefined}
      onPointerDown={stopRight}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      {display}
    </span>
  );
}
