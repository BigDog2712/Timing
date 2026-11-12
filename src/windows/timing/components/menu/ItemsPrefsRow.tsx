/**
 * Timing — 常用事项管理卡 · 单行 ItemsPrefsRow（V0.3.9）
 * -----------------------------------------------------------------------------
 * 一行 = 一个已置顶事项：拖柄 + 名称 + 默认时长 + 移出常用。
 * 排序只留**拖拽**一种可见入口（用户口径「可拖动」）：拖柄可拖，聚焦后 ↑/↓ 也能调，
 * 不再摆 ↑↓ 两个按钮——卡宽受小条窗口限制，多两个按钮名称就只剩「品牌视…」。
 * 拖拽由父级统一收口（dragFrom / dropTarget 都是父级状态），本组件只发事件。
 */
import { formatMinutes } from '../../lib/format';
import { GripIcon, TrashIcon, iconStroke } from '../../lib/icons';
import type { Item } from '../../types/domain';

const SIZE = 16;
const STROKE = iconStroke(SIZE);

export interface ItemsPrefsRowProps {
  item: Item;
  index: number;
  /** 默认倒计时（分钟）；null = 正计时 */
  timer: number | null;
  busy: boolean;
  editing: boolean;
  /** 当前行是拖动落点（高亮上沿） */
  dropTarget: boolean;
  onEdit: (item: Item) => void;
  onRemove: (item: Item) => void;
  onShift: (index: number, delta: number) => void;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  onDragOverAt: (index: number) => void;
  onDropAt: (index: number) => void;
}

export function ItemsPrefsRow({
  item,
  index,
  timer,
  busy,
  editing,
  dropTarget,
  onEdit,
  onRemove,
  onShift,
  onDragStart,
  onDragEnd,
  onDragOverAt,
  onDropAt,
}: ItemsPrefsRowProps) {
  return (
    <div
      className="items-prefs__row"
      data-editing={editing}
      data-over={dropTarget}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOverAt(index);
      }}
      onDrop={() => onDropAt(index)}
    >
      <button
        type="button"
        className="items-prefs__grip"
        draggable={!busy}
        aria-label={`拖动调整「${item.name}」的顺序`}
        title="拖动排序（也可用 ↑ / ↓ 键）"
        onDragStart={() => onDragStart(index)}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onShift(index, -1);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onShift(index, 1);
          }
        }}
      >
        <GripIcon size={SIZE} strokeWidth={STROKE} aria-hidden />
      </button>
      <button
        type="button"
        className="items-prefs__name"
        title="编辑名称与默认倒计时"
        onClick={() => onEdit(item)}
      >
        {item.name}
      </button>
      <span className="items-prefs__meta">
        {timer != null ? formatMinutes(timer * 60) : '正计时'}
      </span>
      <button
        type="button"
        className="items-prefs__act items-prefs__act--danger"
        aria-label={`把「${item.name}」移出常用`}
        disabled={busy}
        onClick={() => onRemove(item)}
      >
        <TrashIcon size={SIZE} strokeWidth={STROKE} aria-hidden />
      </button>
    </div>
  );
}

