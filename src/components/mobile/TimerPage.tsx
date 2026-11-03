/**
 * TickBar — 移动端计时页（Tab ①）
 * -----------------------------------------------------------------------------
 * 结构（PRD §4 ①）：大计时环 + MM:SS + 当前事项名 → 主按钮（四态）+ 独立结束按钮
 *                 → 「倒计时」「换事项」两个入口。
 *
 * 桌面那套「右键 = 结束 / 长按 = 菜单」在手机上不成立（PRD §5 D11）：
 * 结束**必须**是独立按钮（延迟不可接受），所以这里没有任何靠手势才能到达的动作。
 * 主按钮只做一件事——开始 / 暂停 / 继续，与桌面圆环同一语义（`togglePause`）。
 *
 * 状态色与弧形态交给 `TimerRing`（复用 arcSpec），本文件只管布局与动作。
 */
import { useEffect, useState } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { COUNTDOWN_WARN_SEC, ENDED_FLASH_MS } from '../../lib/constants';
import { formatMinutes } from '../../lib/format';
import { PauseIcon, PlayIcon, RepeatIcon, TimerIcon, iconStroke } from '../../lib/icons';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';
import type { VisualState } from '../../types/ui';
import { TimerRing } from './TimerRing';

const PRIMARY_LABEL: Record<VisualState, string> = {
  idle: '开始计时',
  running: '暂停',
  paused: '继续',
  ended: '已保存',
};

export function TimerPage() {
  const actions = useTimerActions();
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const endedAt = useUiStore((s) => s.endedAt);
  const openSheet = useMobileUiStore((s) => s.openSheet);

  /* 结束态是 900ms 的瞬时确认（与药丸同源），不是状态机第四态 */
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (endedAt == null) return;
    setEnded(true);
    const id = window.setTimeout(() => setEnded(false), ENDED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [endedAt]);

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : (session?.itemId ?? null);
  const currentName = findItem(items, currentItemId)?.name ?? '未归类';

  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const targetSec = session?.targetSec ?? 0;
  const remaining = isCountdown ? Math.max(0, targetSec - seconds) : 0;
  const displaySec = isCountdown ? remaining : seconds;
  const progress = isCountdown && targetSec > 0 ? remaining / targetSec : 1;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  const caption = isCountdown
    ? `倒计时 · 目标 ${formatMinutes(targetSec)} · ${currentName}`
    : status === 'idle'
      ? currentName
      : `${currentName} · ${status === 'paused' ? '已暂停' : '进行中'}`;

  return (
    <div className="m-timer">
      <TimerRing
        seconds={displaySec}
        state={visual}
        countdown={isCountdown}
        progress={progress}
        warn={nearEnd}
        caption={caption}
      />

      <div className="m-timer__actions">
        <button
          type="button"
          className="m-primary"
          data-state={visual}
          onClick={() => void actions.togglePause()}
          /* 结束态的 900ms 里不接受点击：那一刻用户刚松手，再点一次会立刻开新会话 */
          disabled={visual === 'ended'}
          aria-label={PRIMARY_LABEL[visual]}
        >
          {visual === 'running' ? (
            <PauseIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          ) : (
            <PlayIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          )}
          {PRIMARY_LABEL[visual]}
        </button>

        {/* 结束是独立按钮：不靠长按、不靠右键，任何时候一眼可见 */}
        {status !== 'idle' && (
          <button type="button" className="m-btn m-btn--danger m-btn--wide" onClick={() => void actions.stop()}>
            结束并保存
          </button>
        )}
      </div>

      <div className="m-timer__tools">
        <button type="button" className="m-tool" onClick={() => openSheet({ kind: 'countdown' })}>
          <TimerIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          <span>倒计时</span>
        </button>
        <button type="button" className="m-tool" onClick={() => openSheet({ kind: 'switchItem' })}>
          <RepeatIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          <span>换事项</span>
        </button>
      </div>

      <p className="m-timer__hint">
        {status === 'idle'
          ? '点上面的大按钮开始；想定时长就用「倒计时」。'
          : '结束会把这一段记入今日记录，3 秒内可撤销。'}
      </p>
    </div>
  );
}
