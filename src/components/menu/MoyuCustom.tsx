/**
 * Timing — 摸鱼菜单 · 其他事项 MoyuCustom（V0.3.2）
 * -----------------------------------------------------------------------------
 * 两步合在一张卡里：**先打事项名，再用滚轮定长**。
 *   - 滚轮：1 分钟 / 格；按住 Shift 为 5 分钟 / 格。
 *   - 键盘：↑ / ↓ 与滚轮同效（滚轮不顺手时的退路）。
 *   - Enter 或「开始」开跑；Esc 或点卡片外收起。
 *
 * 刻意**不做** hover-close：这里要打字，鼠标移到别处是常态，
 * 一飘走就关会让人没法输入。用遮罩点击关闭，边界清楚。
 */
import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent, WheelEvent } from 'react';
import { fitBounds } from '../../lib/fitBounds';
import { formatDuration } from '../../lib/format';
import { clampMoyuMinutes, MOYU_DEFAULT_MINUTES } from '../../lib/moyu';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import '../../styles/moyu.css';

const STEP_MIN = 1;
const STEP_SHIFT = 5;
const W = 216;
const H = 196;
const EDGE = 4;

interface MoyuCustomProps {
  anchor: MenuPos;
  onCancel: () => void;
  onStart: (name: string, minutes: number) => void;
}

export function MoyuCustom({ anchor, onCancel, onStart }: MoyuCustomProps) {
  const close = useUiStore((s) => s.closeMoyuMenu);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(MOYU_DEFAULT_MINUTES);

  const bump = useCallback((delta: number) => {
    setMinutes((current) => clampMoyuMinutes(current + delta));
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? STEP_SHIFT : STEP_MIN;
      bump(event.deltaY < 0 ? step : -step);
    },
    [bump],
  );

  const trimmed = name.trim();

  const commit = useCallback(() => {
    if (trimmed.length === 0) return;
    onStart(trimmed, minutes);
  }, [trimmed, minutes, onStart]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = event.shiftKey ? STEP_SHIFT : STEP_MIN;
      bump(event.key === 'ArrowUp' ? step : -step);
    }
  };

  /* 贴边钳制与 CountdownCustom 同一口径：按显示器工作区算，主窗返回层坐标 */
  const placement = useMemo(() => {
    const viewport = fitBounds();
    const left = Math.min(Math.max(anchor.x, EDGE), Math.max(EDGE, viewport.x + viewport.w - W - EDGE));
    const top = Math.min(Math.max(anchor.y, EDGE), Math.max(EDGE, viewport.y + viewport.h - H - EDGE));
    return { left, top };
  }, [anchor.x, anchor.y]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={close} aria-hidden />
      <div
        className="menu moyu-custom"
        role="dialog"
        aria-label="自定义摸鱼事项"
        style={{ left: `${placement.left}px`, top: `${placement.top}px`, width: `${W}px` }}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div className="menu__group">其他事项</div>

        <label className="moyu-custom__field">
          <input
            type="text"
            className="moyu-custom__input"
            placeholder="事项名称，如「刷手机」"
            maxLength={40}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="moyu-custom__value" aria-live="polite">
          {formatDuration(minutes * 60)}
        </div>
        <p className="moyu-custom__hint">滚轮调整 · Shift 快调 · Enter 开始</p>

        <div className="moyu-custom__actions">
          <button type="button" className="btn btn--ghost cd-custom__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary cd-custom__btn"
            disabled={trimmed.length === 0}
            onClick={commit}
          >
            开始
          </button>
        </div>
      </div>
    </>
  );
}
