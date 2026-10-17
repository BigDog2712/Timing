/**
 * TickBar — 事项名（1fr 截断，超长保留开头）
 * -----------------------------------------------------------------------------
 * 截断规则（pill-bar.md §1）：超过 11 个中文字符省略号，保留**开头**。
 * 悬停完整名：使用原生 `title`（浏览器 tooltip，零依赖、可访问）。
 * [V0.2.0] 左键点事项名 → 打开「常用事项」菜单（common-items.md 触发入口）。
 */
import type { KeyboardEvent } from 'react';
import { NAME_MAX_CHARS } from '../../lib/constants';
import { truncateName } from '../../lib/format';

interface ItemNameProps {
  name: string;
  /** PAUSED 下用 --muted 弱化（pill-bar.md §3.1） */
  muted?: boolean;
  /** [V0.2.0] 左键点击回调（常用事项入口） */
  onClick?: () => void;
}

export function ItemName({ name, muted = false, onClick }: ItemNameProps) {
  const display = truncateName(name, NAME_MAX_CHARS);
  const isTruncated = display !== name.trim();
  const interactive = typeof onClick === 'function';

  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
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
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : undefined}
      data-tauri-drag-region
    >
      {display}
    </span>
  );
}
