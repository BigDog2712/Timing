/**
 * Timing — 通用底部半屏 Sheet（移动端所有浮层的唯一外壳）
 * -----------------------------------------------------------------------------
 * 关闭方式（PRD §5 D10：手机没有 hover，浮层只能靠明确手势退场）：
 *   1. 点遮罩；2. 下滑抓取柄；3. Android 返回键（由 MobileShell 的 history 守卫转成 closeSheet）。
 * `dismissible=false` 用于崩溃恢复：那是必须做决定的三选一，划走它等于把数据悬空。
 *
 * 为什么不 portal：整壳（.m-shell）本身就是全屏定位根，Sheet 直接挂在它的覆盖层里即可，
 * 少一跳 DOM 就少一处 z-index 打架。遮罩用 --scrim 纯色（禁 backdrop-filter）。
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { XIcon, iconStroke } from '../../lib/icons';

/** 下滑超过这个距离（px）即关闭：小于它算手抖，大于它用户意图明确 */
const SWIPE_CLOSE_PX = 72;

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部操作区（主按钮常驻，不随内容滚动） */
  footer?: ReactNode;
  dismissible?: boolean;
  /** 无障碍：模态对话框（崩溃恢复）用 alertdialog */
  role?: 'dialog' | 'alertdialog';
}

export function Sheet({ title, onClose, children, footer, dismissible = true, role = 'dialog' }: SheetProps) {
  const [dy, setDy] = useState(0);
  const startY = useRef<number | null>(null);

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startY.current == null) return;
    setDy(Math.max(0, e.clientY - startY.current));
  };
  const onGripUp = () => {
    const moved = dy;
    startY.current = null;
    setDy(0);
    if (moved >= SWIPE_CLOSE_PX) onClose();
  };

  return (
    <div className="m-scrim" onClick={dismissible ? onClose : undefined}>
      <div
        className="m-sheet"
        role={role}
        aria-modal="true"
        aria-label={title}
        data-dragging={dy > 0 ? 'true' : 'false'}
        style={{ transform: `translateY(${dy}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {dismissible && (
          <div
            className="m-sheet__grip"
            aria-hidden
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          >
            <span />
          </div>
        )}

        <header className="m-sheet__head">
          <h2 className="m-sheet__title">{title}</h2>
          {dismissible && (
            <button type="button" className="m-iconbtn" aria-label="关闭" onClick={onClose}>
              <XIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
            </button>
          )}
        </header>

        <div className="m-sheet__body">{children}</div>
        {footer && <div className="m-sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}
