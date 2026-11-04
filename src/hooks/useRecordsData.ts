/**
 * Timing — 记录面板数据（今天 / 本周，按事项聚合 + 明细）
 * -----------------------------------------------------------------------------
 * 并发拉取 stats_summary（总计 + byItem 聚合）与 list_records（明细，limit=100）。
 * 客户端按 itemId 归组：聚合时长取 summary（与后端一致），明细取分页记录。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorText, ipc } from '../services/ipc';
import { rangeBounds, type RecordsRange } from '../lib/time';
import { itemName, useItemStore } from '../stores/itemStore';
import { IPC_EVENTS, MAX_PAGE_SIZE } from '../types/domain';
import type { Item, MdSyncReport, TimeRecord } from '../types/domain';
import { useTauriEvent } from './useTauriEvent';

export interface RecordGroup {
  itemId: number;
  name: string;
  totalSec: number;
  records: TimeRecord[];
}

interface RecordsData {
  loading: boolean;
  error: string | null;
  totalSec: number;
  recordCount: number;
  groups: RecordGroup[];
  reload: () => void;
}

function buildGroups(rows: TimeRecord[], items: Item[], byItem: { itemId: number; totalSec: number }[]): RecordGroup[] {
  const rowsByItem = new Map<number, TimeRecord[]>();
  for (const row of rows) {
    const list = rowsByItem.get(row.itemId);
    if (list) list.push(row);
    else rowsByItem.set(row.itemId, [row]);
  }
  // 以 byItem（后端降序聚合）为准保证排序；补上仅明细里出现的事项
  const ordered = [...byItem];
  for (const id of rowsByItem.keys()) {
    if (!ordered.some((g) => g.itemId === id)) ordered.push({ itemId: id, totalSec: 0 });
  }
  return ordered.map((g) => ({
    itemId: g.itemId,
    name: itemName(items, g.itemId),
    totalSec: g.totalSec,
    records: (rowsByItem.get(g.itemId) ?? []).slice().sort((a, b) => b.startedAt - a.startedAt),
  }));
}

export function useRecordsData(range: RecordsRange): RecordsData {
  const items = useItemStore((s) => s.items);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSec, setTotalSec] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [rows, setRows] = useState<TimeRecord[]>([]);
  const [byItem, setByItem] = useState<{ itemId: number; totalSec: number }[]>([]);
  const [nonce, setNonce] = useState(0);

  const bounds = useMemo(() => rangeBounds(range), [range]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [summary, page] = await Promise.all([
          ipc.statsSummary({ from: bounds.from, to: bounds.to }),
          ipc.listRecords({ from: bounds.from, to: bounds.to, page: 1, limit: MAX_PAGE_SIZE }),
        ]);
        if (cancelled) return;
        setTotalSec(summary.totalSec);
        setRecordCount(summary.recordCount);
        setByItem(summary.byItem);
        setRows(page.items);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds.from, bounds.to, nonce]);

  const groups = useMemo(() => buildGroups(rows, items, byItem), [rows, items, byItem]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    if (report.kinds.includes('timers')) reload();
  });

  return { loading, error, totalSec, recordCount, groups, reload };
}
