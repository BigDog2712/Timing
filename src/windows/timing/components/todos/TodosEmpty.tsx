/**
 * Timing — 事项窗口空态（todos-panel.md §3.3）
 * -----------------------------------------------------------------------------
 * 图标块（34×34 圆角块）+ 两行文案 + accent 主按钮；不给空白。
 */
import { ClockIcon, iconStroke, PlusIcon } from '../../lib/icons';

interface TodosEmptyProps {
  onAdd: () => void;
}

export function TodosEmpty({ onAdd }: TodosEmptyProps) {
  return (
    <div className="todos__empty">
      <span className="todos__empty-icon">
        <ClockIcon size={24} strokeWidth={iconStroke(24)} aria-hidden />
      </span>
      <p className="todos__empty-title">今天还没有计时记录</p>
      <p className="todos__empty-hint">左键小条开始，或从下面新建一条</p>
      <button type="button" className="btn btn--primary btn--sm" onClick={onAdd}>
        <PlusIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        新增待办
      </button>
    </div>
  );
}
