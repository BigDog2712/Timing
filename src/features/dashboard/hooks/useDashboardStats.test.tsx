/**
 * `useDashboardStats` 的刷新态判据（D-01）
 * -----------------------------------------------------------------------------
 * 用户口径（0.12.1 末）：「主界面数据闪烁」。根因不是渲染抖动，而是**刷新时把状态打回
 * `loading`** —— `moduleState()` 把 loading 映射成骨架，于是每次 `tracking-data-changed`
 * （每次切前台应用、每落一批会话）四张卡整块换成骨架条，看上去就是数据在闪。
 *
 * 判据只钉一件事：**已有当天快照时，刷新期间 `status` 不许退回 `loading`**。
 * 首屏（无快照）仍然必须是 `loading` —— 两只反证各占一边，删掉任一分支都会红。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DashboardSnapshot } from '../services/dashboardReadModel.ts';
import { clearDashboardSnapshotCache } from '../services/dashboardSnapshotCache.ts';
import {
  resolveTrackerHealth,
  TRACKER_HEARTBEAT_STALE_AFTER_MS,
} from '../../../shared/types/tracking.ts';
import { useDashboardStats } from './useDashboardStats.ts';

function makeSnapshot(fetchedAtMs: number): DashboardSnapshot {
  return {
    fetchedAtMs,
    icons: {},
    activityRecords: [],
    yesterdayActivityRecords: [],
    hasActiveSession: false,
  };
}

const HEALTH = resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS);

interface Seen {
  status: string;
  hasSnapshot: boolean;
}

let container: HTMLDivElement;
let root: Root;
let seen: Seen;

function Probe({ refreshKey, load }: { refreshKey: number; load: () => Promise<DashboardSnapshot> }) {
  const { readState } = useDashboardStats(30, refreshKey, HEALTH, load, 0, true, true);
  seen = { status: readState.status, hasSnapshot: readState.hasSnapshot };
  return null;
}

function render(refreshKey: number, load: () => Promise<DashboardSnapshot>): void {
  act(() => {
    root.render(createElement(Probe, { refreshKey, load }));
  });
}

/** 让挂起的 promise 回调跑完（React 的 setState 也要在 act 里） */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  clearDashboardSnapshotCache();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('D-01：刷新不许把已有数据打回骨架', () => {
  it('d01_status_never_falls_back_to_loading_once_a_snapshot_exists', async () => {
    const pendings: Array<(snapshot: DashboardSnapshot) => void> = [];
    const load = () => new Promise<DashboardSnapshot>((resolve) => { pendings.push(resolve); });

    render(0, load);
    /* 首屏：没有快照 → 必须是 loading（否则四张卡在零数据时画空态，比骨架更糟） */
    expect(seen).toEqual({ status: 'loading', hasSnapshot: false });

    await act(async () => { pendings[0](makeSnapshot(1_000)); });
    await flush();
    expect(seen).toEqual({ status: 'ready', hasSnapshot: true });

    /* 第二次刷新（refreshKey 变 = 一次 tracking-data-changed）：快照还在，状态**不许**回落。
       把 useDashboardStats 的 keep 分支删掉 → 这里立刻变成 loading（= 用户看到的闪烁）。 */
    render(1, load);
    expect(seen).toEqual({ status: 'ready', hasSnapshot: true });

    await act(async () => { pendings[1](makeSnapshot(2_000)); });
    await flush();
    expect(seen).toEqual({ status: 'ready', hasSnapshot: true });
  });
});
