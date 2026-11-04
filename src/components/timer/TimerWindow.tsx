import { useEffect, useMemo, useState } from 'react';
import { timerWindowActions } from '../../services/timerWindowActions';
import type { TimerState } from '../../types/domain';

function liveSeconds(state: TimerState): number {
  const session = state.session;
  if (!session || session.runningSince == null) return state.liveDurationSec;
  return session.accumulatedSec + Math.max(0, Math.floor((Date.now() - session.runningSince) / 1000));
}

function formatSeconds(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const statusText: Record<TimerState['status'], string> = {
  idle: '空闲',
  running: '计时中',
  paused: '已暂停',
};

export function TimerWindow() {
  const [state, setState] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    void timerWindowActions.load().then((value) => mounted && setState(value)).catch((e: unknown) => {
      if (mounted) setError(e instanceof Error ? e.message : '读取计时状态失败');
    });
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      void timerWindowActions.load().then((value) => mounted && setState(value));
    }, 1000);
    let unlisten: (() => void) | undefined;
    void timerWindowActions.subscribe((value) => mounted && setState(value)).then((stop) => {
      if (mounted) unlisten = stop;
      else stop();
    });
    return () => { mounted = false; window.clearInterval(refresh); unlisten?.(); };
  }, []);

  const elapsed = useMemo(() => {
    if (!state) return 0;
    void now;
    return liveSeconds(state);
  }, [state, now]);
  const remaining = state?.remainingSec == null ? null : Math.max(0, state.remainingSec - (state.status === 'running' ? Math.max(0, elapsed - state.liveDurationSec) : 0));
  return (
    <main className="panel-window timer-window" aria-label="只读计时器">
      <header className="panel-window__header" data-tauri-drag-region="true"><h1>Timer</h1><span>{state ? statusText[state.status] : '加载中'}</span></header>
      <section className="panel-window__body">
        <p className="timer-window__item">{state?.session ? `事项 #${state.session.itemId}` : '暂无进行中的事项'}</p>
        <strong className="timer-window__clock">{formatSeconds(state?.mode === 'countdown' && remaining != null ? remaining : elapsed)}</strong>
        {state?.mode === 'countdown' && <p>倒计时</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
