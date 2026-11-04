/**
 * TickBar — 事项窗左侧「便利贴预览」卡（V0.3.9）
 * -----------------------------------------------------------------------------
 * 用户口径：「在事项菜单（事项组件右键唤起的菜单）里鼠标悬停在事项上时，若该事项有便利贴，
 * 应在事项左侧预览便利贴」。
 *
 * 位置：事项窗为了它整体加宽了 240px（`window_spec::TODOS_PREVIEW_INSET`），面板靠右贴住
 * 主条原位，**左边这 240px 是透明区**——本卡就画在那里，不遮挡任何行。
 * 用 portal 挂到 body：`.todos` 有 `overflow:hidden` + `backdrop-filter`（会成为 fixed 的
 * 包含块），卡片放它里面会被裁掉。
 * 只读预览：正文最多十来行，滚轮可看全文；点一下 → 打开那张便利贴的窗口继续编辑。
 */
import { createPortal } from 'react-dom';
import { notePreviewBox } from '../../lib/notePreview';

interface NotePreviewProps {
  /** 事项名（卡头小字，便于确认这是哪个事项的便利贴） */
  itemName: string;
  content: string;
  /** 悬停行在视口中的 top（卡顶对齐该行，超出视口时由 notePreviewStyle 钳制） */
  anchorTop: number;
  onOpen: () => void;
  onEnter: () => void;
  onLeave: () => void;
}

export function NotePreview({ itemName, content, anchorTop, onOpen, onEnter, onLeave }: NotePreviewProps) {
  return createPortal(
    <div
      className="note-preview"
      style={notePreviewBox(anchorTop, window.innerHeight)}
      role="button"
      tabIndex={-1}
      aria-label={`便利贴预览：${itemName}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onOpen}
    >
      <div className="note-preview__head">{itemName}</div>
      <div className="note-preview__body">{content.trim().length > 0 ? content : '（空白便利贴）'}</div>
    </div>,
    document.body,
  );
}
