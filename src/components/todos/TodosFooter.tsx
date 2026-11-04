/**
 * TickBar — 事项窗口底栏（todos-panel.md §1 底栏高 40）
 * -----------------------------------------------------------------------------
 * 「＋ 新增待办」（accent sm，flex 1.3）+「编辑事项」（ghost sm，flex 1）。
 * 「编辑事项」= 开启行内编辑模式（行尾显示 改名 / 删除 图标按钮），aria-pressed 表达开关态。
 */
import { iconStroke, PencilIcon, PlusIcon } from '../../lib/icons';

interface TodosFooterProps {
  onAdd: () => void;
  onToggleEdit: () => void;
  editMode: boolean;
}

export function TodosFooter({ onAdd, onToggleEdit, editMode }: TodosFooterProps) {
  return (
    <footer className="todos__foot">
      <button type="button" className="btn btn--primary btn--sm todos__foot-add" onClick={onAdd}>
        <PlusIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        新增待办
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm todos__foot-edit"
        data-on={editMode ? 'true' : 'false'}
        aria-pressed={editMode}
        onClick={onToggleEdit}
      >
        <PencilIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        编辑事项
      </button>
    </footer>
  );
}
