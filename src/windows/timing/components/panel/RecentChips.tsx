/**
 * Timing — 最近事项 chips（panel.md §1 / §2，上限 4 个，含「+ 新建」）
 * -----------------------------------------------------------------------------
 * 点 chip → 切换/开始该事项；「+ 新建」→ 焦点回到输入框（原地新建，不新开面板）。
 */
import { PlusIcon, iconStroke } from '../../lib/icons';
import type { Item } from '../../types/domain';

interface RecentChipsProps {
  items: Item[];
  onPick: (itemId: number) => void;
  onCreate: () => void;
}

export function RecentChips({ items, onPick, onCreate }: RecentChipsProps) {
  return (
    <div className="panel__chips">
      {items.map((item) => (
        <button key={item.id} type="button" className="chip" onClick={() => onPick(item.id)}>
          {item.name}
        </button>
      ))}
      <button type="button" className="chip chip--add" onClick={onCreate} aria-label="新建事项">
        <PlusIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        <span>新建</span>
      </button>
    </div>
  );
}
