/**
 * Timing — 今日计时数据（事项窗口「今日计时」区）
 * -----------------------------------------------------------------------------
 * 并发 stats_summary（总计/条数）+ list_records（明细，limit=MAX_PAGE_SIZE）。
 * 范围锁定「今天 00:00 → 明天 00:00」（本地时区，作用字段 startedAt，与 lib/time::rangeBounds('day') 同口径）。
 * 仅取 saved 记录；进行中的会话由调用方叠加（来源 timerStore，避免与 list_records 重复）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, ipc } from '../services/ipc';
import { startOfDay } from '../lib/time';
import { IPC_EVENTS, MAX_PAGE_SIZE } from '../types/domain';
import type { MdSyncReport, TimeRecord, TimerState } from '../types/domain';
import { useTauriEvent } from './useTauriEvent';

export interface TodayRecordsData {
  loading: boolean;
  error: string | null;
  /** 今日已保存记录合计秒数 */
  totalSec: number;
  /**
   * 今日已保存记录条数（`stats_summary.recordCount`）。
   * 与 `rows.length` 的区别：明细只拉 100 条一页的循环，条数超过时会与聚合不一致；
   * 汇总条要的是**统计口径**的条数，所以单独透出这个值。
   */
  recordCount: number;
  /** 今日已保存记录（startedAt 降序） */
  rows: TimeRecord[];
  reload: () => void;
}

function tomorrowStart(): number {
  const from = startOfDay();
  const end = new Date(from);
  end.setDate(end.getDate() + 1);
  return end.getTime();
}

export function useTodayRecords(): TodayRecordsData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSec, setTotalSec] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [rows, setRows] = useState<TimeRecord[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const from = startOfDay();
    const to = tomorrowStart();
    void (async () => {
      try {
        const [summary, page] = await Promise.all([
          ipc.statsSummary({ from, to }),
          ipc.listRecords({ from, to, page: 1, limit: MAX_PAGE_SIZE }),
        ]);
        const records = [...page.items];
        for (let next = 2; records.length < page.total; next += 1) {
          const more = await ipc.listRecords({ from, to, page: next, limit: MAX_PAGE_SIZE });
          if (cancelled) return;
          if (more.items.length === 0) break;
          records.push(...more.items);
        }
        if (cancelled) return;
        setTotalSec(summary.totalSec);
        setRecordCount(summary.recordCount);
        setRows(records.sort((a, b) => b.startedAt - a.startedAt));
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /* [V0.4.0] Markdown 改时间 / 删组后，今日计时区立即跟上，不必等切窗。 */
  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    if (report.kinds.includes('timers')) reload();
  });

  /* [V0.11.2] 会话结束（手动停止 / 倒计时到点 / 切换事项）后自动重拉。
     事件到达时那条记录刚由 active 转 saved：调用方叠加的「进行中」行消失，
     而它还没进 `rows` —— 界面上这段时间会凭空不见，今日总时长也少一块，
     用户只能切窗或手动刷新才看到。放在 hook 内统一处理，免得两个页面各写一遍。 */
  const lastStatus = useRef<string | null>(null);
  useTauriEvent<TimerState>(IPC_EVENTS.timerStateChanged, (next) => {
    const prev = lastStatus.current;
    lastStatus.current = next.status;
    if (prev != null && prev !== 'idle' && next.status === 'idle') reload();
  });

  return { loading, error, totalSec, recordCount, rows, reload };
}
