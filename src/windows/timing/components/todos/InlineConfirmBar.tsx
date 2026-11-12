/**
 * Timing — 内联删除确认条 InlineConfirmBar（todos-panel.md §3.4「Delete → 内联确认」）
 * -----------------------------------------------------------------------------
 * 不弹阻塞对话框：文案 + 确认（danger）+ 取消。
 */
interface InlineConfirmBarProps {
  text: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirmBar({ text, confirmLabel = '删除', onConfirm, onCancel }: InlineConfirmBarProps) {
  return (
    <span className="inline-confirm">
      <span className="inline-confirm__text">{text}</span>
      <button type="button" className="inline-confirm__ok" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" className="inline-confirm__cancel" onClick={onCancel}>
        取消
      </button>
    </span>
  );
}
