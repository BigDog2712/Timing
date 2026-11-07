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

const api = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), open: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdBackupApi: { list: api.list, restore: api.restore, open: api.open },
  mdSyncApi: { get: vi.fn(async () => null), save: vi.fn(), run: vi.fn(), open: vi.fn() },
  /* 真 `errorText`（`services/ipc` 那个映射）对 `MD_SYNC_CONFIG_INVALID` 就是「原样透出
     后端 message」，它自己的映射由 `check:contract` 静态强制；这里加一个前缀，是为了让
     「哪一处用了哪个函数」在断言里可分辨（恢复用 errorText、打开用 rawIpcText）。 */
  errorText: (err: unknown) => `[润色] ${err instanceof Error ? err.message : '操作失败'}`,
  /* [V0.11.15] 「打开」失败必须原文透出：`errorText()` 会把 `IO_ERROR` 润色成
     「系统调用失败，请重试」，所以卡片用的是 `rawIpcText`。实现若换成 `errorText`，
     下面那条「打开」用例里的 `[润色]` 前缀就会露出来 → 变红。 */
  rawIpcText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { MdSyncBackupCard } from './MdSyncBackupCard';
import { useBackupList } from './useBackupList';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* 三份底：两份同一天（按 atMs 倒序），一份是老备份（无归属、读不出日期） */
const ITEMS: MdBackupItem[] = [
  { name: 'obsidian__2026-11-05.md', target: 'obsidian', source: '2026-11-05.md', date: '2026-11-05', atMs: 1762340000000, bytes: 4096 },
  { name: 'webdav__2026-11-05.md', target: 'webdav', source: '2026-11-05.md', date: '2026-11-05', atMs: 1762340600000, bytes: 8192 },
  { name: 'legacy.md', target: null, source: '2026-11-03.md', date: null, atMs: 1762170000000, bytes: 2048 },
];

let container: HTMLDivElement; let root: Root;

/** [V0.11.16] 卡片不再自己拉列表：吃 `useBackupList` 那一份（设置页只调一次 IPC） */
function Harness() {
  const list = useBackupList();
  return createElement(MdSyncBackupCard, { list });
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
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
    api.open.mockReset();
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

  /* [V0.11.14] O4 之后「恢复」多了一条常见失败路径：云端通道没配时不再静默写进
     Obsidian 落点，而是回 `MD_SYNC_CONFIG_INVALID`。这条用例钉的是**用户看得见**——
     卡片若把错误吞掉，用户看到的就是「点了确认没反应」。 */
  it('恢复被后端拒绝时，把原文显示出来而不是静默', async () => {
    const reason = '这份备份属于「WebDAV」落点，但云端通道没开启或没填完整；'
      + '请先在设置里配好「WebDAV」，或换一个落点恢复';
    api.restore.mockRejectedValue(new Error(reason));
    await mount();
    await click(container.querySelectorAll('.sync-backup__go')[0]);
    await click(confirmButton());
    expect(api.restore).toHaveBeenCalledWith('webdav__2026-11-05.md', 'webdav');
    expect(texts('.sync__error').join('')).toContain('云端通道没开启或没填完整');
    expect(container.textContent).not.toContain('已恢复');
  });

  /* [V0.11.15] 需求 3.6：备份能在系统默认程序里打开看。用 `rawIpcText` 而不是
     `errorText()`——后者会把 `IO_ERROR` 润色成「系统调用失败，请重试」，
     用户就再也看不到「文件不存在：…」这句唯一能照做的话（PRD D2）。 */
  it('点「打开」把备份名交给后端，失败时原文就地显示、不带润色', async () => {
    api.open.mockRejectedValue(new Error('文件不存在：obsidian__2026-11-05.md'));
    await mount();
    /* 组内按 atMs 倒序：同一天里 webdav 在前，所以按归属标签找 Obsidian 那一行 */
    const row = Array.from(container.querySelectorAll('.sync-backup__row'))
      .find((el) => el.textContent?.includes('Obsidian 落点')) as HTMLElement;
    const openButton = Array.from(row.querySelectorAll('button'))
      .find((el) => el.textContent === '打开');
    await click(openButton);

    expect(api.open).toHaveBeenCalledWith('obsidian__2026-11-05.md');
    expect(row.querySelector('.sync__error')?.textContent).toBe('文件不存在：obsidian__2026-11-05.md');
    expect(container.textContent).not.toContain('[润色]');
  });

  it('打开成功时不显示红字', async () => {
    api.open.mockResolvedValue(undefined);
    await mount();
    const row = container.querySelector('.sync-backup__row') as HTMLElement;
    await click(Array.from(row.querySelectorAll('button')).find((el) => el.textContent === '打开'));

    expect(api.open).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('手机端整卡不渲染（列表也不去读，见 `useBackupList.test`）', async () => {
    host.mobile = true;
    await mount();
    expect(container.innerHTML).toBe('');
  });
});
