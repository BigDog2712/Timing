import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem } from '../../types/domain';

/* [V0.11.16] 备份列表的**单一数据源**。三条判据：
   1. 挂载只调一次 `md_backup_list`（折叠标题下的当条记录 + 展开后的列表共用这一份，
      否则一次打开设置页会发两条一模一样的命令，两次结果还可能不同）；
   2. `latest` 是全局 `atMs` 最大者，空列表是 `null`；
   3. 手机端**早退不调 IPC**（`md_backup_list` 在手机端会回 MD_SYNC_CONFIG_INVALID，
      拉一次就是设置页一片红字）。 */

const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdBackupApi: { list: api.list },
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { useBackupList, type MdBackupList } from './useBackupList';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: MdBackupItem[] = [
  { name: 'a.md', target: 'obsidian', source: '2026-11-05.md', date: '2026-11-05', atMs: 1000, bytes: 1 },
  { name: 'c.md', target: 'webdav', source: '2026-11-07.md', date: '2026-11-07', atMs: 3000, bytes: 3 },
  { name: 'b.md', target: null, source: '2026-11-06.md', date: null, atMs: 2000, bytes: 2 },
];

let container: HTMLDivElement;
let root: Root;
let list: MdBackupList | null = null;

function Harness() {
  list = useBackupList();
  return null;
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const current = (): MdBackupList => {
  if (!list) throw new Error('列表还没挂上');
  return list;
};

describe('useBackupList —— 备份列表的唯一数据源', () => {
  beforeEach(() => {
    host.mobile = false;
    api.list.mockReset();
    api.list.mockResolvedValue(ITEMS);
    list = null;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('挂载只调一次 md_backup_list，latest 取全局 atMs 最大者', async () => {
    await mount();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(current().loading).toBe(false);
    expect(current().error).toBeNull();
    expect(current().items).toHaveLength(3);
    expect(current().latest?.name).toBe('c.md');
  });

  it('空列表 → latest 是 null（那行显示「还没有备份。」，由组件负责）', async () => {
    api.list.mockResolvedValueOnce([]);
    await mount();
    expect(current().items).toEqual([]);
    expect(current().latest).toBeNull();
  });

  it('读取失败把原文留在 error 里，latest 退回 null（不假装「还没有备份」以外的状态）', async () => {
    api.list.mockRejectedValueOnce(new Error('备份目录读不到'));
    await mount();
    expect(current().error).toBe('备份目录读不到');
    expect(current().latest).toBeNull();
  });

  it('refresh 再拉一次（刷新按钮 / 恢复之后各调一次）', async () => {
    await mount();
    await act(async () => { await current().refresh(); });
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('手机端早退：一次 IPC 都不发', async () => {
    host.mobile = true;
    await mount();
    expect(api.list).not.toHaveBeenCalled();
    expect(current().loading).toBe(false);
    expect(current().latest).toBeNull();
  });
});
