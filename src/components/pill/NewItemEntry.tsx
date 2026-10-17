/**
 * TickBar — 空状态入口「新建事项」（IDLE 时替代事项名，pill-bar.md §3.2 Empty）
 * -----------------------------------------------------------------------------
 * 点击打开新建面板（Panel 触发入口之一）。
 */
import { PlusIcon, iconStroke } from '../../lib/icons';

interface NewItemEntryProps {
  onClick: () => void;
}

export function NewItemEntry({ onClick }: NewItemEntryProps) {
  return (
    <button type="button" className="pill__empty" onClick={onClick} aria-label="新建事项并开始计时">
      <PlusIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
      <span>新建事项</span>
    </button>
  );
}
