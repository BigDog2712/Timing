/**
 * Timing — 移动端计时页（Tab ①）
 * -----------------------------------------------------------------------------
 * 结构（PRD §4 ①）：大计时环 + MM:SS + 当前事项名 → 主按钮（四态）+ 独立结束按钮
 *                 → 「倒计时」「换事项」两个入口。
 *
 * [V0.11.30] 工具条多一个「同步」：主人不想为了同步一次跑进设置页翻三层。
 * 它调的是设置页那个「立即同步」的**同一个**命令（`mobileNative.syncRun`），
 * 结果走提示条，不在这里复制一份同步逻辑。
 *
 * 桌面那套「右键 = 结束 / 长按 = 菜单」在手机上不成立（PRD §5 D11）：
 * 结束**必须**是独立按钮（延迟不可接受），所以这里没有任何靠手势才能到达的动作。
 * 主按钮只做一件事——开始 / 暂停 / 继续，与桌面圆环同一语义（`togglePause`）。
 *
 * 状态色与弧形态交给 `TimerRing`（复用 arcSpec），本文件只管布局与动作。
 */
import { useState } from 'react';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { useStopNaming } from '../../hooks/useStopNaming';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { COUNTDOWN_WARN_SEC } from '../../lib/constants';
import { formatMinutes } from '../../lib/format';
import { PauseIcon, PlayIcon, RepeatIcon, RotateCcwIcon, TimerIcon, iconStroke } from '../../lib/icons';
import { syncErrorText, syncReportText } from '../../lib/mdSyncText';
import { mobileNative } from '../../services/mobileNative';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useUiStore } from '../../stores/uiStore';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
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
  /* [V0.11.32] 结束走这条出口：这段要是挂在「未归类」名下，结束后面板会问名字。
     直接 `actions.stop()` 会静默把"没名字的一笔"留在库里。 */
  const stopWithNaming = useStopNaming();
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const setNotice = useUiStore((s) => s.setNotice);
  /* 同步中不给第二次点击：`md_sync_run` 在跑的时候再发一次只会拿到一条「正在同步」的错误，
     而用户看到的是按钮闪了一下没反应。 */
  const [syncing, setSyncing] = useState(false);

  /* 结束态是 900ms 的瞬时确认（与药丸同源），不是状态机第四态。
     hook 内部按 `endedAt` 的窗口判定：切 Tab 重挂载不会把上一次结束重放一遍。 */
  const ended = useEndedFlash();

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : (session?.itemId ?? null);
  const currentName = findItem(items, currentItemId)?.name ?? '未归类';

  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const targetSec = session?.targetSec ?? 0;
  const remaining = isCountdown ? Math.max(0, targetSec - seconds) : 0;
  const displaySec = isCountdown ? remaining : seconds;
  const progress = isCountdown && targetSec > 0 ? remaining / targetSec : 1;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      setNotice({ tone: 'info', text: syncReportText(await mobileNative.syncRun()) });
    } catch (err) {
      /* 原文优先：手机上的同步失败多半是「云端 401」或原生桥的错，
         被润色成「系统调用失败」就只剩盲猜（同 `lib/mdSyncText` 的口径）。 */
      setNotice({ tone: 'danger', text: `同步失败：${syncErrorText(err)}` });
    } finally {
      setSyncing(false);
    }
  };

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
          <button
            type="button"
            className="m-btn m-btn--danger m-btn--wide"
            onClick={() => void stopWithNaming()}
          >
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
        <button
          type="button"
          className="m-tool"
          data-busy={syncing ? 'true' : 'false'}
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          <RotateCcwIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
          <span>{syncing ? '同步中' : '同步'}</span>
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
