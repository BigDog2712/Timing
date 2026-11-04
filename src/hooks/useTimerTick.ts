/**
 * Timing — 本地计时 tick（R-4：公式必须与 get_timer_state 完全一致）
 * -----------------------------------------------------------------------------
 * 服务端公式（IPC-CONTRACT-v2 §4.2）：
 *   liveDurationSec = accumulatedSec + (running ? floor((now - runningSince) / 1000) : 0)
 * 前端以同一公式基于 Date.now() 每秒推算，避免状态同步瞬间数字跳变。
 */
import { useEffect, useState } from 'react';
import { useTimerStore } from '../stores/timerStore';
import type { TimeRecord } from '../types/domain';

/** 依据会话快照推算实时累计秒（与 Rust 侧同公式） */
export function computeLiveSec(session: TimeRecord | null): number {
  if (!session) return 0;
  const base = session.accumulatedSec ?? 0;
  if (session.runningSince == null) return base;
  const deltaMs = Date.now() - session.runningSince;
  // 与 Rust `floor_sec` 对齐：负差值（系统时钟回拨）按 0 处理。
  // 若直接 Math.floor，回拨 1 小时会显示 -3600 秒，用户看到计时倒退。
  return base + (deltaMs > 0 ? Math.floor(deltaMs / 1000) : 0);
}

/** 返回当前应显示的实时累计秒（idle 为 0；running 每秒更新；paused 冻结） */
export function useTimerTick(): number {
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const [seconds, setSeconds] = useState(() => computeLiveSec(session));

  // 会话关键字段变化时立即重算（不必等下一秒）
  const signature = `${status}|${session?.id ?? 0}|${session?.runningSince ?? 0}|${session?.accumulatedSec ?? 0}`;

  useEffect(() => {
    setSeconds(computeLiveSec(session));
    if (status !== 'running' || !session) return;
    const id = window.setInterval(() => setSeconds(computeLiveSec(session)), 1000);
    return () => window.clearInterval(id);
    // session/status 已由 signature 覆盖（signature 含 status/id/runningSince/accumulatedSec）
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 用 signature 代替对象依赖，避免 session 换引用就重建定时器
  }, [signature]);

  return seconds;
}
