/**
 * TickBar — 便利贴自定义标题栏 NoteHeader（sticky-note.md §1 / §3.3 / §5）
 * -----------------------------------------------------------------------------
 * - 标题 13/600（取正文首行；空 → 「未命名」--ink-4）；超长省略号。
 * - 右侧三枚 26×26 图标按钮：pin（hover 显示）/ trash（hover --danger）/ x。
 * - **`data-tauri-drag-region` 只放标题区**（放正文会抢输入；按钮为兄弟节点不触发拖动）。
 * - 未悬停时整块淡出（opacity 0 / pointer-events none）由 note.css 的 .note:hover 驱动。
 */
import { PinIcon, PinOffIcon, TrashIcon, XIcon } from '../../lib/icons';

interface NoteHeaderProps {
  title: string;
  /** 无标题（空内容）→ 用 --ink-4 弱化 */
  untitled: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onRequestDelete: () => void;
  onRequestClose: () => void;
}

export function NoteHeader({ title, untitled, pinned, onTogglePin, onRequestDelete, onRequestClose }: NoteHeaderProps) {
  const Pin = pinned ? PinIcon : PinOffIcon;
  return (
    <header className="note__head">
      <span
        className="note__title"
        data-untitled={untitled ? 'true' : 'false'}
        title={title}
        data-tauri-drag-region
      >
        {title}
      </span>
      <div className="note__actions">
        <button
          type="button"
          className="note__icon"
          aria-label={pinned ? '取消置顶' : '置顶'}
          aria-pressed={pinned}
          title={pinned ? '取消置顶' : '置顶'}
          onClick={onTogglePin}
        >
          <Pin size={14} strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          className="note__icon note__icon--danger"
          aria-label="删除便利贴"
          title="删除便利贴"
          onClick={onRequestDelete}
        >
          <TrashIcon size={14} strokeWidth={1.5} aria-hidden />
        </button>
        <button type="button" className="note__icon" aria-label="关闭" title="关闭" onClick={onRequestClose}>
          <XIcon size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </header>
  );
}
