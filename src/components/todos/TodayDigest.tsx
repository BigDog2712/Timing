import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTodayRecords } from '../../hooks/useTodayRecords';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerStore } from '../../stores/timerStore';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useHoverClose } from '../../hooks/useHoverClose';
import { useItemStore } from '../../stores/itemStore';
import { errorText } from '../../services/ipc';
import { recordApi } from '../../services/api';
// Added by host agent; this component expects the daily digest status service contract.
import { getDailyDigestStatuses, setDailyDigestStatus } from '../../services/dailyStatusActions';
import { openOverviewInAnalysis } from '../../services/todayActions';
import { formatMinutes } from '../../lib/format';
import { CheckIcon, ClockIcon, ListIcon, PlayIcon, TrashIcon, iconStroke } from '../../lib/icons';
import { GlassMenu, type MenuEntry } from '../menu/GlassMenu';
import '../../styles/today-digest.css';

export interface TodayDigestProps { onClose: () => void; onViewRecords: () => void; }
type DigestStatus = 'pending' | 'done';
interface DigestRow { itemId: number; itemIds: number[]; name: string; totalSec: number; status: DigestStatus; }
interface MenuState { x: number; y: number; row: DigestRow; }

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TodayDigest({ onClose, onViewRecords }: TodayDigestProps) {
  const today = useTodayRecords();
  const items = useItemStore((state) => state.items);
  const timerState = useTimerStore((state) => state.state);
  const session = timerState.session;
  const liveSec = useTimerTick();
  const timerActions = useTimerActions();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [statuses, setStatuses] = useState<Record<number, DigestStatus>>({});
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [statusesLoadError, setStatusesLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useHoverClose(onClose, menu == null);
  const date = useMemo(() => localDateKey(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    setStatusesLoading(true);
    void getDailyDigestStatuses(date).then((result) => {
      if (!cancelled) setStatuses(result);
    }).catch((error: unknown) => {
      if (!cancelled) { setStatusesLoadError(true); setActionError(errorText(error)); }
    }).finally(() => {
      if (!cancelled) setStatusesLoading(false);
    });
    return () => { cancelled = true; };
  }, [date]);

  const rows = useMemo(() => {
    const totals = new Map<number, number>();
    for (const record of today.rows) totals.set(record.itemId, (totals.get(record.itemId) ?? 0) + record.accumulatedSec);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (session && session.startedAt >= todayStart.getTime()) {
      totals.set(session.itemId, (totals.get(session.itemId) ?? 0) + liveSec);
    }
    const grouped = new Map<string, { itemId: number; itemIds: number[]; totalSec: number }>();
    for (const [itemId, totalSec] of totals) {
      const name = items.find((item) => item.id === itemId)?.name ?? '未归类';
      const group = grouped.get(name);
      if (group) { group.itemIds.push(itemId); group.totalSec += totalSec; }
      else grouped.set(name, { itemId, itemIds: [itemId], totalSec });
    }
    return [...grouped.entries()].map(([name, group]) => ({
      ...group,
      name,
      status: statuses[group.itemId] ?? 'pending',
    })).sort((a, b) => b.totalSec - a.totalSec || a.name.localeCompare(b.name));
  }, [items, liveSec, session, statuses, today.rows]);

  const run = async (operation: () => Promise<void>) => {
    setActionError(null);
    try { await operation(); } catch (error) { setActionError(errorText(error)); }
  };
  const openMenu = (event: ReactMouseEvent, row: DigestRow) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, row });
  };
  const isCurrentName = (name: string) => session != null && items.find((item) => item.id === session.itemId)?.name === name;
  const startRow = async (row: DigestRow) => {
    if (timerState.status === 'idle') { await timerActions.start(row.itemId); onClose(); return; }
    if (isCurrentName(row.name)) {
      if (timerState.status === 'paused') await timerActions.togglePause();
      onClose();
      return;
    }
    await timerActions.switchTo(row.itemId, 'end_and_start');
    onClose();
  };
  const deleteTodayRecords = async (row: DigestRow) => {
    if (isCurrentName(row.name)) throw new Error('当前会话同名，先结束计时再删');
    const ids = new Set(row.itemIds);
    const records = today.rows.filter((record) => ids.has(record.itemId));
    if (records.length === 0) return;
    for (const record of records) await recordApi.remove({ id: record.id });
    await today.reload();
  };
  const toggleStatus = async (row: DigestRow) => {
    const next: DigestStatus = row.status === 'done' ? 'pending' : 'done';
    await setDailyDigestStatus(date, row.itemId, next);
    setStatuses((current) => ({ ...current, [row.itemId]: next }));
  };
  const menuEntries = (row: DigestRow): MenuEntry[] => {
    const currentName = isCurrentName(row.name);
    return [
      { type: 'item', id: 'start', label: currentName ? timerState.status === 'paused' ? '继续计时' : '当前正在计时' : '开始计时', icon: PlayIcon, disabled: currentName && timerState.status === 'running', onSelect: () => void run(() => startRow(row)) },
      { type: 'separator', id: 'separator' },
      { type: 'item', id: 'status', label: row.status === 'done' ? '标为待进行' : '标为已完成', icon: CheckIcon, checked: row.status === 'done', disabled: statusesLoading, onSelect: () => void run(() => toggleStatus(row)) },
      { type: 'item', id: 'delete', label: currentName ? '当前会话同名，先结束计时再删' : '删除今日计时记录', icon: TrashIcon, danger: !currentName, disabled: currentName || !today.rows.some((record) => row.itemIds.includes(record.itemId)), onSelect: () => void run(() => deleteTodayRecords(row)) },
      { type: 'item', id: 'records', label: '查看今日计时明细', icon: ListIcon, onSelect: onViewRecords },
    ];
  };

  const totalSec = rows.reduce((sum, row) => sum + row.totalSec, 0);
  return <section className="panel today-digest" role="dialog" aria-label="今日事项" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <header className="today-digest__head"><h2>今日事项 <span>{rows.length ? `· ${rows.length} 项` : '· 还没有'}</span></h2>{rows.length > 0 && <time>{formatMinutes(totalSec)}</time>}</header>
    <div className="today-digest__body">
      {(today.loading || statusesLoading) && <p className="today-digest__state">正在加载…</p>}
      {!today.loading && today.error && <div className="today-digest__state" role="alert"><p>{today.error}</p><button type="button" className="btn btn--ghost btn--sm" onClick={today.reload}>重试</button></div>}
      {statusesLoadError && <p className="today-digest__state" role="alert">事项状态读取失败，完成状态操作暂不可用。</p>}
      {!today.loading && !today.error && !statusesLoading && rows.length === 0 && <div className="today-digest__empty"><ClockIcon size={24} strokeWidth={iconStroke(24)} aria-hidden /><strong>今天还没有事项</strong><span>开始一次计时后会显示在这里</span></div>}
      {!today.loading && !today.error && !statusesLoading && rows.map((row) => <button key={row.name} type="button" className="today-digest__row" data-active={isCurrentName(row.name)} data-done={row.status === 'done'} onContextMenu={(event) => openMenu(event, row)} onClick={() => void run(() => startRow(row))}><span className="today-digest__mark" data-done={row.status === 'done'} aria-hidden>{row.status === 'done' && <CheckIcon size={12} strokeWidth={iconStroke(16)} />}</span><span className="today-digest__name" title={row.name}>{row.name}</span><span className="today-digest__duration">{formatMinutes(row.totalSec)}</span></button>)}
    </div>
    {actionError && <p className="today-digest__error" role="alert">{actionError}</p>}
    <footer className="today-digest__footer">
      {/* [P1-02] E4：摘要面板 → 分析窗总览页（`{ target: { overview: true } }`，冷启动也成立）。 */}
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openOverviewInAnalysis()}>在分析窗看总览 ↗</button>
      <button type="button" className="btn btn--accent btn--sm" onClick={onViewRecords}>查看今日计时</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>关闭</button>
    </footer>
    {menu && <><div className="menu-scrim" onMouseDown={() => setMenu(null)} aria-hidden /><GlassMenu entries={menuEntries(menu.row)} anchor={{ x: menu.x, y: menu.y }} ariaLabel={`事项「${menu.row.name}」操作`} onClose={() => setMenu(null)} /></>}
  </section>;
}
