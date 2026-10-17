/**
 * TickBar — 便利贴删除内联确认条 NoteConfirm（sticky-note.md §3.4）
 * -----------------------------------------------------------------------------
 * 替换 Timing 的「两次点击 + 3s 超时」：可见、可读、说明连带影响。
 *   - 容器 --note-confirm-bg（--danger-wash）+ 1px --note-confirm-line 描边 + --radius-md。
 *   - 窄宽自适应（note 宽 < 200px）→ 按钮竖排各 width:100%（CSS 用容器查问句承载，
 *     `noteConfirmStackBelowW = 200` 属组件内部布局断点，不入 window 配置 / domain 常量）。
 *   - 按钮：danger 确认 + ghost 取消。
 */
interface NoteConfirmProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function NoteConfirm({ onCancel, onConfirm }: NoteConfirmProps) {
  return (
    <div className="note__confirm" role="alertdialog" aria-label="确认删除便利贴">
      <p className="note__confirm-title">删除这张便利贴？</p>
      <p className="note__confirm-desc">记录行里已同步的那条备注也会一并移除。</p>
      <div className="note__confirm-actions">
        <button type="button" className="btn btn--ghost note__confirm-btn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn note__confirm-btn note__confirm-danger" onClick={onConfirm} data-danger>
          确认删除
        </button>
      </div>
    </div>
  );
}
