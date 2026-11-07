import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem, MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { REMOVED_PHRASES } from './mdSyncCopy';
import { formatAtShort } from './mdBackupFacts';

/* [V0.11.16] QA 补的**端到端**判据（走真 `MdSyncTab`，不拿替身 draft 自证）。

   已有测试的分工与漏洞：
   - `mdSyncShared.test.ts` 测纯函数与 Hook，但「什么都不改直接保存」只断言了
     `resolvedBindings`，没走一次真正的 `save()`；
   - `mdSyncLayout.test.tsx` 走了 `save()`，但三档 `file` **完全相同**
     （`{date}.md`），于是「被统一成 `{date}.md`」这种误伤在它面前是隐形的；
   - `MdFormatBlock.test.tsx` 的 draft 是 `vi.fn()` 替身，测的是「调了哪个回调」。

   所以这里用**三档 `file` 与 `root` 全不同**的真实配置，逐字段比 `api.save` 的入参：
   任何一次误扇出都会同时改掉两档，跑不掉。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}-notes.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}-todos.md', heading: '#### 待办事项' },
];

const ITEMS: MdBackupItem[] = [
  { name: 'webdav__2026-11-06.md', target: 'webdav', source: '2026-11-06.md', date: '2026-11-06', atMs: 1793955900000, bytes: 8192 },
  { name: 'obsidian__2026-11-07.md', target: 'obsidian', source: '2026-11-07.md', date: '2026-11-07', atMs: 1794060840000, bytes: 3276 },
  { name: 'legacy.md', target: null, source: '2026-11-03.md', date: null, atMs: 1793689200000, bytes: 2048 },
];

function view(bindings: MdSyncBinding[] = BINDINGS): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

const DATA_ROOT: DataRootInfo = {
  current: 'D:\\Timing\\data',
  defaultPath: 'C:\\Program Files\\Timing\\data',
  isDefault: false,
  writable: true,
  writableError: null,
  pending: null,
  previous: null,
  sizeBytes: 2048,
  entries: [],
  affected: [],
  pluginsInDataRoot: false,
};

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
const backupApi = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), open: vi.fn() }));
const rootApi = vi.hoisted(() => ({ get: vi.fn(), change: vi.fn(), open: vi.fn() }));

vi.mock('../../services/api', () => ({
  mdSyncApi: api,
  mdBackupApi: backupApi,
  dataRootApi: rootApi,
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
  rawIpcText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { MdSyncTab } from './MdSyncTab';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdSyncTab));
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

/** 折叠块的 chevron 只有图标、没有文字：按 `aria-label`（`展开${title}`）找 */
function foldToggle(title: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="展开${title}"]`)
    ?? container.querySelector(`button[aria-label="收起${title}"]`);
  if (!found) throw new Error(`找不到折叠按钮：${title}`);
  return found as HTMLButtonElement;
}

const input = (label: string) =>
  container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;

async function setValue(target: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function save(): Promise<MdSyncViewCloud['config']> {
  await act(async () => {
    button('保存并同步').click();
    await Promise.resolve();
  });
  const calls = api.save.mock.calls;
  if (calls.length === 0) throw new Error('保存没有被调用');
  return calls[calls.length - 1][0] as MdSyncViewCloud['config'];
}

const filesOf = (config: MdSyncViewCloud['config']) => config.bindings.map((item) => item.file);
const rootsOf = (config: MdSyncViewCloud['config']) => config.bindings.map((item) => item.root);

describe('一个框写三档 —— 端到端（三档 file 与 root 全不同）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue(ITEMS);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(view());
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('B4：打开设置 → 什么都不改 → 保存 → 三档 file / root 逐字段原样落库', async () => {
    await mount();
    /* 文件名框显示的是计时那一档（PRD 4.1），另外两档只在灰字提示里露名字 */
    expect(input('日记文件名')?.value).toBe('{date}.md');

    const saved = await save();
    expect(filesOf(saved)).toEqual(['{date}.md', '{date}-notes.md', '{date}-todos.md']);
    expect(rootsOf(saved)).toEqual(['C:\\Vault', 'C:\\Vault2', '%APP_DIR%\\md']);
    /* 整条落点逐字段比：任何一个字段被「顺手统一」都会红 */
    expect(saved.bindings).toEqual(BINDINGS);
  });

  it('T1：文件名打上 x.md 再改回 {date}.md → 算没改，三档仍是原值', async () => {
    await mount();
    const field = input('日记文件名') as HTMLInputElement;
    await setValue(field, 'x.md');
    /* 中间这一帧必须是真的「已改」状态，否则本用例测的就不是边界而是恒等 */
    expect(input('日记文件名')?.value).toBe('x.md');
    await setValue(field, '{date}.md');

    const saved = await save();
    expect(filesOf(saved)).toEqual(['{date}.md', '{date}-notes.md', '{date}-todos.md']);
    expect(saved.bindings).toEqual(BINDINGS);
  });

  it('手改文件名 → 三档统一（扇出不能退化成「永远不扇出」）', async () => {
    await mount();
    await setValue(input('日记文件名') as HTMLInputElement, '{date}-asd.md');

    const saved = await save();
    expect(filesOf(saved)).toEqual(['{date}-asd.md', '{date}-asd.md', '{date}-asd.md']);
    /* 只改 file：root 三档保持原值，字段之间不许串味 */
    expect(rootsOf(saved)).toEqual(['C:\\Vault', 'C:\\Vault2', '%APP_DIR%\\md']);
  });

  it('先改日记落点、再在逐档面板改一档 → 统一意图先落到其余档，被手改那档用他改的值', async () => {
    await mount();
    await setValue(input('日记落点根目录') as HTMLInputElement, 'D:\\md');
    /* 此时统一意图生效：保存的话三档都会是 D:\md */
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });

    await setValue(input('便利贴落点根目录') as HTMLInputElement, 'D:\\manual');
    /* [QA F2 回修] 手改那一刻意图就固化了：单框显示的上限那档仍是 D:\md，不会当场跳回 C:\Vault */
    expect(input('日记落点根目录')?.value).toBe('D:\\md');

    const saved = await save();
    /* 期望：单框填的 D:\md 落到**其余各档**，被手改那一档保留手改值。
       首版这里是 ['C:\\Vault','D:\\manual','%APP_DIR%\\md']——用户亲手打的 D:\md 凭空消失。 */
    expect(rootsOf(saved)).toEqual(['D:\\md', 'D:\\manual', 'D:\\md']);
    /* 只影响 root：file 三档仍是原值（改了 root 不该顺手把 file 也统一掉） */
    expect(filesOf(saved)).toEqual(['{date}.md', '{date}-notes.md', '{date}-todos.md']);
  });
});

describe('文案减法与备份块的端到端判据', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue(ITEMS);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(view());
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('A2：展开「逐个设置」之后，DOM 里也搜不到那三句被删掉的话', async () => {
    await mount();
    expect(container.querySelectorAll('.sync__card')).toHaveLength(0);
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });

    /* 三行（含档位开关与根目录框）真的挂上了，才谈得上「展开后也搜不到」 */
    expect(container.querySelectorAll('.sync__card')).toHaveLength(3);
    const text = container.textContent ?? '';
    for (const phrase of REMOVED_PHRASES) {
      expect(text).not.toContain(phrase);
    }
    expect(text).not.toContain('文件模板');
  });

  it('F2：折叠那行与展开后列表第一条是同一份（时间/动作/文件名/大小）', async () => {
    await mount();
    const summary = container.querySelector('[data-block="data-backup"] .sync__latest')?.textContent;
    expect(summary).toBe('最近：11-07 22:14 · 覆盖前备份 · 2026-11-07.md · 3.2 KB');

    /* 展开后第一条 = 日期分组倒序的第一组里的第一行，必须就是上面那一份 */
    await act(async () => { foldToggle('备份数据管理').click(); await Promise.resolve(); });
    const groups = Array.from(container.querySelectorAll('.sync-backup__group'));
    expect(groups).toHaveLength(3);
    expect(groups[0].querySelector('.sync-backup__date')?.textContent).toBe('2026-11-07');

    const first = groups[0].querySelector('.sync-backup__row');
    expect(first?.querySelector('.sync-backup__source')?.textContent).toBe('2026-11-07.md');
    expect(first?.querySelector('.sync-backup__facts')?.textContent).toContain('3.2 KB');
    expect(first?.querySelector('.sync-backup__facts')?.textContent).toContain('2026-11-07');
    /* 折叠行的时间与列表第一条是同一个时刻（`atMs` 最大的那条） */
    expect(summary).toContain(formatAtShort(ITEMS[1].atMs));
    /* [QA F4] 两处时间**同一个格式**：列表行也必须是 `MM-DD HH:mm`，
       且整页不能再出现 `YYYY/MM/DD` 那种旧形态（同一页两种时间本身就是缺陷） */
    expect(first?.querySelector('.sync-backup__facts')?.textContent).toContain(formatAtShort(ITEMS[1].atMs));
    expect(container.textContent).not.toContain('2026/11/07');
  });

  it('F2/F3：`md_backup_list` 只发一次；空列表时那一行说「还没有备份。」', async () => {
    await mount();
    expect(backupApi.list).toHaveBeenCalledTimes(1);
    await act(async () => { foldToggle('备份数据管理').click(); await Promise.resolve(); });
    /* 展开不会重拉：折叠行与列表共用同一份数据 */
    expect(backupApi.list).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    container.remove();
    backupApi.list.mockResolvedValue([]);
    await mount();
    expect(container.querySelector('[data-block="data-backup"] .sync__latest')?.textContent).toBe('还没有备份。');
  });
});
