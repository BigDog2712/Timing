/**
 * TickBar — 今日计时数据（事项窗口「今日计时」区）
 * -----------------------------------------------------------------------------
 * 并发 stats_summary（总计/条数）+ list_records（明细，limit=MAX_PAGE_SIZE）。
 * 范围锁定「今天 00:00 → 明天 00:00」（本地时区，作用字段 startedAt，与 lib/time::rangeBounds('day') 同口径）。
 * 仅取 saved 记录；进行中的会话由调用方叠加（来源 timerStore，避免与 list_records 重复）。
 */
import { useCallback, useEffect, useState } from 'react';
import { errorText, ipc } from '../services/ipc';
import { startOfDay } from '../lib/time';
import { MAX_PAGE_SIZE } from '../types/domain';
import type { TimeRecord } from '../types/domain';

export interface TodayRecordsData {
  loading: boolean;
  error: string | null;
  /** 今日已保存记录合计秒数 */
  totalSec: number;
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
        if (cancelled) return;
        setTotalSec(summary.totalSec);
        setRows(page.items.slice().sort((a, b) => b.startedAt - a.startedAt));
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

  return { loading, error, totalSec, rows, reload };
}
