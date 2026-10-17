/**
 * TickBar — 事项右键菜单（context-menu.md §3.1「事项右键」· 事项窗口内触发）
 * -----------------------------------------------------------------------------
 * 项：停止计时 · {事项名} / 编辑事项 / [批2] 便利贴… · 倒计时… · 提醒… / 删除事项（危险）。
 * 批2 新增入口（本批实现）：
 *   - 便利贴…  → openNoteForItem（关联该事项，AC-63）
 *   - 倒计时…  → 打开时长菜单（在本窗浮出，见 Batch2Overlays）
 *   - 提醒…    → 打开提醒设置卡（reminder_set；提醒 ≠ 结束计时）
 * 备注类项（增加/编辑/复制备注）依赖备注能力，本批不生成。
 */
import { StickyNoteIcon, PencilIcon, SquareIcon, TimerIcon, CalendarClockIcon, TrashIcon } from '../../lib/icons';
import { reminderActions } from '../../services/reminderActions';
import { useUiStore } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry } from '../menu/GlassMenu';

interface TodosItemMenuProps {
  anchor: { x: number; y: number };
  itemId: number;
  itemName: string;
  /** 该事项是否 = 当前计时会话的事项（否则「停止计时」不可用） */
  isActive: boolean;
  onClose: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 便利贴…（关联该事项） */
  onNote: () => void;
}

export function TodosItemMenu({
  anchor,
  itemId,
  itemName,
  isActive,
  onClose,
  onStop,
  onEdit,
  onDelete,
  onNote,
}: TodosItemMenuProps) {
  const entries: MenuEntry[] = [
    {
      type: 'item',
      id: 'stop',
      label: `停止计时 · ${itemName}`,
      icon: SquareIcon,
      disabled: !isActive,
      onSelect: onStop,
    },
    { type: 'item', id: 'edit', label: '编辑事项', icon: PencilIcon, onSelect: onEdit },
    { type: 'separator', id: 'sep-batch2' },
    { type: 'item', id: 'note', label: '便利贴…', icon: StickyNoteIcon, onSelect: onNote },
    {
      type: 'item',
      id: 'countdown',
      label: '倒计时…',
      icon: TimerIcon,
      onSelect: () => useUiStore.getState().openCountdownMenu({ pos: anchor, itemId }),
    },
    {
      type: 'item',
      id: 'reminder',
      label: '提醒…',
      icon: CalendarClockIcon,
      onSelect: () => reminderActions.openSet('item', itemId, itemName, anchor),
    },
    { type: 'separator', id: 'sep-danger' },
    { type: 'item', id: 'delete', label: '删除事项', icon: TrashIcon, danger: true, onSelect: onDelete },
  ];

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} aria-hidden />
      <GlassMenu entries={entries} anchor={anchor} ariaLabel={`事项「${itemName}」操作`} onClose={onClose} />
    </>
  );
}
