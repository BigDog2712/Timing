/**
 * TickBar — 自定义时长输入 CountdownCustom（countdown-menu.md §3.2 Edge）
 * -----------------------------------------------------------------------------
 * 「自定义…」展开的玻璃小表单：分钟 + 秒两输入；Enter 提交、Esc 取消。
 *   - 非法（0 / < 1 分钟）→ 输入框 1px --danger + 行下 11px 提示（最短 1 分钟）。
 *   - 上限 MAX_COUNTDOWN_SEC（24h）→ 提示「最长 24 小时」。
 *   - 计时中（active）→ 备注「将结束当前并开始」。
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import { useHoverClose } from '../../hooks/useHoverClose';

interface CountdownCustomProps {
  anchor: MenuPos;
  initialSec: number;
  onCancel: () => void;
  onSubmit: (targetSec: number) => void;
}

const MIN_SEC = 1;
const MAX_SEC = 5400;
const W = 200;
const H = 132;
const EDGE = 4;

export function CountdownCustom({ anchor, initialSec, onCancel, onSubmit }: CountdownCustomProps) {
  const [minutes, setMinutes] = useState(String(Math.floor(initialSec / 60)));
  const [seconds, setSeconds] = useState(String(initialSec % 60));
  const [error, setError] = useState<string | null>(null);

  const close = useUiStore((s) => s.closeCountdownMenu);

  /* [V0.2.7] 指针离开即收（自定义时长也是小条触发的浮层） */
  useHoverClose(close);

  const commit = () => {
    const m = Number.parseInt(minutes || '0', 10);
    const s = Number.parseInt(seconds || '0', 10);
    const total = (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
    if (total < MIN_SEC) {
      setError('最短 1 秒');
      return;
    }
    if (total > MAX_SEC) {
      setError('最长 90 分钟');
      return;
    }
    onSubmit(total);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const left = Math.min(Math.max(anchor.x, EDGE), Math.max(EDGE, window.innerWidth - W - EDGE));
  const top = Math.min(Math.max(anchor.y, EDGE), Math.max(EDGE, window.innerHeight - H - EDGE));

  return (
    <>
      <div className="menu-scrim" onMouseDown={close} aria-hidden />
      <div
        className="menu menu--countdown-custom"
        role="dialog"
        aria-label="自定义倒计时时长"
        style={{ left: `${left}px`, top: `${top}px` }}
        onKeyDown={handleKeyDown}
      >
        <div className="menu__group">自定义时长</div>
        <div className="cd-custom__row">
          <label className="cd-custom__field">
            <input
              type="number"
              min={0}
              max={90}
              value={minutes}
              autoFocus
              className="cd-custom__input"
              onChange={(e) => {
                setMinutes(e.target.value);
                setError(null);
              }}
            />
            <span className="cd-custom__unit">分</span>
          </label>
          <label className="cd-custom__field">
            <input
              type="number"
              min={0}
              max={59}
              value={seconds}
              className="cd-custom__input"
              onChange={(e) => {
                setSeconds(e.target.value);
                setError(null);
              }}
            />
            <span className="cd-custom__unit">秒</span>
          </label>
        </div>
        {error ? (
          <p className="cd-custom__error">{error}</p>
        ) : (
          <p className="cd-custom__hint">Enter 保存时长，再点圆环开始</p>
        )}
        <div className="cd-custom__actions">
          <button type="button" className="btn btn--ghost cd-custom__btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn--primary cd-custom__btn" onClick={commit}>
            确定
          </button>
        </div>
      </div>
    </>
  );
}
