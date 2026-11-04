/**
 * Timing — 便利贴手柄 NoteHandle（V0.2.1：手柄改绑便利贴，不再「收起为圆点」）
 * -----------------------------------------------------------------------------
 * 规格沿用 DESIGN-V0.2.0 §5.3 抓取柄：viewBox 12×22、stroke 2.5、路径 M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4，
 * **仅 hover 显示**（opacity 0 → 1）。语义改为便利贴入口：
 *   - 左键：唤出**当前事项**的便利贴（已有则开那张，否则新建）；无当前事项 → 开一张未关联便签。
 *   - 右键：唤出**便利贴清单**（锚点取手柄左下，见 uiStore.notesListPos）。
 * 拖动不由本组件管：左键 pointerdown 正常冒泡给 PillBar 的拖动判定，拖起来后由后者吞掉 click，
 * 故「按住手柄直接拖窗口」与「单击开便利贴」互不干扰。
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';

interface NoteHandleProps {
  /** 当前事项（计时中 = session.itemId；空闲 = 上次事项）；null = 无 */
  itemId: number | null;
  onOpenNote: () => void;
  onOpenList: (pos: { x: number; y: number }) => void;
}

export function NoteHandle({ itemId, onOpenNote, onOpenList }: NoteHandleProps) {
  /** 最近一次「右键抬起」打开清单的时刻（用于让随后的 contextmenu 不重复触发） */
  const rightUpAt = useRef(0);

  /* 右键：只拦右键，左键留给 PillBar 的拖动判定 */
  const stopRightDown = (e: ReactPointerEvent) => {
    if (e.button === 2) e.stopPropagation();
  };

  /* 右键抬起即开清单：不依赖平台是否派发 contextmenu（WebView2 里右键 pointerup 一定有） */
  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 2) return;
    e.stopPropagation();
    rightUpAt.current = Date.now();
    const r = e.currentTarget.getBoundingClientRect();
    onOpenList({ x: r.left - 6, y: r.bottom + 4 });
  };

  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onOpenNote();
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    /* 与 handlePointerUp 二选一：同一物理右键先 pointerup 再 contextmenu，避免开两次 */
    if (Date.now() - rightUpAt.current < 400) return;
    const r = e.currentTarget.getBoundingClientRect();
    onOpenList({ x: r.left - 6, y: r.bottom + 4 });
  };

  return (
    <button
      type="button"
      className="pill__handle"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={stopRightDown}
      onPointerUp={handlePointerUp}
      aria-label={itemId == null ? '打开空白便利贴' : '打开当前事项便利贴'}
      aria-haspopup="menu"
      title={itemId == null ? '便利贴 · 右键看清单' : '当前事项便利贴 · 右键看清单'}
    >
      <svg
        width="12"
        height="22"
        viewBox="0 0 12 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4" />
      </svg>
    </button>
  );
}
