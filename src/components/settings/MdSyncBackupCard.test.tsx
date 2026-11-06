import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* `IS_MOBILE` 是编译期常量：用可变开关做替身，同一文件里分别测手机端 / 桌面端 */
const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const api = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdBackupApi: { list: api.list, restore: api.restore },
  mdSyncApi: { get: vi.fn(async () => null), save: vi.fn(), run: vi.fn(), open: vi.fn() },
}));

import { MdSyncBackupCard } from './MdSyncBackupCard';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* 三份底：两份同一天（按 atMs 倒序），一份是老备份（无归属、读不出日期） */
const ITEMS: MdBackupItem[] = [
  { name: 'obsidian__2026-11-05.md', target: 'obsidian', source: '2026-11-05.md', date: '2026-11-05', atMs: 1762340000000, bytes: 4096 },
  { name: 'webdav__2026-11-05.md', target: 'webdav', source: '2026-11-05.md', date: '2026-11-05', atMs: 1762340600000, bytes: 8192 },
  { name: 'legacy.md', target: null, source: '2026-11-03.md', date: null, atMs: 1762170000000, bytes: 2048 },
];

let container: HTMLDivElement; let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(MdSyncBackupCard)); await Promise.resolve(); });
}

const texts = (selector: string) => Array.from(container.querySelectorAll(selector)).map((el) => el.textContent);
const confirmButton = () => Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '确认恢复');

async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('找不到要点的元素');
  await act(async () => { (element as HTMLElement).click(); await Promise.resolve(); });
}

describe('MdSyncBackupCard', () => {
  beforeEach(() => {
    host.mobile = false;
    api.list.mockReset();
    api.restore.mockReset();
    api.list.mockResolvedValue(ITEMS);
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('按日期分组、组内倒序，老备份落在「归属未知」组', async () => {
    await mount();
    expect(texts('.sync-backup__date')).toEqual(['2026-11-05', '归属未知']);
    expect(texts('.sync-backup__target')).toEqual(['云端落点', 'Obsidian 落点', '归属未知']);
    expect(container.textContent).toContain('8.0 KB');
    expect(container.textContent).toContain('—');
  });

  it('点「恢复」只展开确认条，确认之前不发请求', async () => {
    await mount();
    expect(api.restore).not.toHaveBeenCalled();
    await click(container.querySelector('.sync-backup__go'));
    expect(api.restore).not.toHaveBeenCalled();
    expect(container.textContent).toContain('会用这份备份覆盖当前文件');
  });

  it('确认文案说清「自动留底」，确认后按归属恢复并刷新列表', async () => {
    api.restore.mockResolvedValue({ date: '2026-11-05', target: 'obsidian', imported: 3, written: 1 });
    await mount();
    await click(container.querySelectorAll('.sync-backup__go')[1]);
    expect(container.textContent).toContain('会用这份备份覆盖当前文件');
    expect(container.textContent).toContain('恢复本身不会让你再丢一次');

    await click(confirmButton());
    expect(api.restore).toHaveBeenCalledWith('obsidian__2026-11-05.md', 'obsidian');
    expect(container.textContent).toContain('已恢复 2026-11-05 的备份：覆盖 1 个文件，导入 3 条记录');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('老备份（归属未知）默认恢复到 Obsidian 落点', async () => {
    api.restore.mockResolvedValue({ date: '2026-11-03', target: 'obsidian', imported: 1, written: 1 });
    await mount();
    await click(container.querySelectorAll('.sync-backup__go')[2]);
    /* 归属未知才让用户选落点，默认 Obsidian */
    expect(texts('.sync-backup__confirm .seg__item')).toEqual(['Obsidian 落点', '云端落点']);
    await click(confirmButton());
    expect(api.restore).toHaveBeenCalledWith('legacy.md', 'obsidian');
  });

  it('手机端整卡不渲染，也不去读备份列表', async () => {
    host.mobile = true;
    await mount();
    expect(container.innerHTML).toBe('');
    expect(api.list).not.toHaveBeenCalled();
  });
});
