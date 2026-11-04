/**
 * 倒计时独立卡：参照 Timing v1.7.3 CountdownPanel。
 * 空闲时显示已设定时长；滚轮按 5 分钟调整，右键交给九档菜单，左键启动。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, WheelEvent } from 'react';
import { useHoverClose } from '../../hooks/useHoverClose';
import { defaultCountdownSec } from '../../lib/countdown';
import { clientToLayer } from '../../lib/fitBounds';
import { formatDuration } from '../../lib/format';
import { countdownActions } from '../../services/countdownActions';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore, type MenuPos } from '../../stores/uiStore';
import '../../styles/countdown-card.css';

const MIN_SEC = 1;
const MAX_SEC = 5400;
const STEP_SEC = 300;

export interface CountdownCardProps {
  anchor: MenuPos;
  onClose: () => void;
  onMenu: (pos: MenuPos) => void;
}

function clampSeconds(seconds: number): number {
  return Math.min(MAX_SEC, Math.max(MIN_SEC, seconds));
}

export function CountdownCard({ anchor, onClose, onMenu }: CountdownCardProps) {
  const armedSec = useCountdownArmStore((state) => state.armedSec);
  const arm = useCountdownArmStore((state) => state.arm);
  const timerState = useTimerStore((state) => state.state);
  const setNotice = useUiStore((state) => state.setNotice);
  /* [P1 优化] 未设定过时长时显示参考设置的「默认倒计时」（Timing 默认 25 分钟），
     不再硬编码 1500，避免与设置页口径分叉。 */
  const defaultSec = useSettingsStore((state) => defaultCountdownSec(state.referenceSettings));
  const [displaySec, setDisplaySec] = useState(armedSec ?? defaultSec);
  const displayRef = useRef(displaySec);

  useHoverClose(onClose);

  useEffect(() => {
    if (armedSec == null) return;
    displayRef.current = armedSec;
    setDisplaySec(armedSec);
  }, [armedSec]);

  const updateDuration = useCallback((seconds: number) => {
    const next = clampSeconds(seconds);
    displayRef.current = next;
    setDisplaySec(next);
    arm(next);
  }, [arm]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;
    updateDuration(displayRef.current + direction * STEP_SEC);
  }, [updateDuration]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMenu(clientToLayer(event.clientX, event.clientY));
  }, [onMenu]);

  const handleClick = useCallback(() => {
    if (timerState.status !== 'idle') return;
    const targetSec = displayRef.current;
    void countdownActions.start(undefined, targetSec, false).then(onClose).catch((error: unknown) => {
      setNotice({ text: error instanceof Error ? error.message : '启动倒计时失败', tone: 'danger' });
    });
  }, [onClose, setNotice, timerState.status]);

  const style = useMemo(() => ({ left: `${anchor.x}px`, top: `${anchor.y}px` }), [anchor.x, anchor.y]);
  const locked = timerState.status !== 'idle';

  return (
    <div
      className="menu countdown-card"
      role="button"
      tabIndex={0}
      aria-label="倒计时卡"
      aria-disabled={locked}
      data-locked={locked ? 'true' : 'false'}
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onWheel={handleWheel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="countdown-card__mode">倒计时</div>
      <div className="countdown-card__value">{formatDuration(displaySec)}</div>
      <div className="countdown-card__hint">滚轮调整 · 右键设置</div>
    </div>
  );
}
