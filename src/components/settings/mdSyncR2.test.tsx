import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem, MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { formatAtShort } from './mdBackupFacts';

/* [V0.11.16 第 2 轮 / V0.11.26 收口] QA 独立复核 R1–R4，全部走**真 `MdSyncTab`**。
   R1 `cloudWebdav === null` → 块⑤ 直接给预填默认值，且块内零载体分段（O2 / O5）。
   R2 `updateBinding` 固化统一意图：手改一档时其余档吃下已生效的意图；没有意图不扇出。
   R3 C11 按 `affected` 实际档数说话；R4 时间格式只有一份。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}-notes.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}-todos.md', heading: '#### 待办事项' },
];

const ITEMS: MdBackupItem[] = [
  { name: 'webdav__2026-11-06.md', target: 'webdav', source: '2026-11-06.md', date: '2026-11-06', atMs: 1793955900000, bytes: 8192 },
  { name: 'obsidian__2026-11-07.md', target: 'obsidian', source: '2026-11-07.md', date: '2026-11-07', atMs: 1794060840000, bytes: 3276 },
];

function view(options: { bindings?: MdSyncBinding[]; webdav?: MdSyncViewCloud['config']['cloudWebdav'] } = {}): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: {
      enabled: true,
      pollSecs: 900,
      bindings: options.bindings ?? BINDINGS,
      cloud: null,
      cloudFolder: null,
      cloudWebdav: options.webdav ?? null,
    },
    cloud: { enabled: false, mode: 'webdav', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    local: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

function dataRoot(affected: string[]): DataRootInfo {
  return {
    current: 'D:\\Timing\\data',
    defaultPath: 'C:\\Program Files\\Timing\\data',
    isDefault: false,
    writable: true,
    writableError: null,
    pending: null,
    previous: null,
    sizeBytes: 2048,
    entries: [],
    affected,
    pluginsInDataRoot: false,
  };
}

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

const rootsOf = (config: MdSyncViewCloud['config']) => config.bindings.map((item) => item.root);
const filesOf = (config: MdSyncViewCloud['config']) => config.bindings.map((item) => item.file);

function beforeEachReset(): void {
  for (const fn of [api.get, api.save, api.run]) fn.mockReset();
  backupApi.list.mockReset();
  backupApi.list.mockResolvedValue(ITEMS);
  rootApi.get.mockReset();
  rootApi.get.mockResolvedValue(dataRoot(['事项计时', '便利贴', '待办事项']));
  api.get.mockResolvedValue(view());
  api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
  useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
}

describe('R1：块⑤ 从没配过时直接给预填默认值（cloudWebdav === null）', () => {
  beforeEach(beforeEachReset);
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('O5：不点任何分段（已无分段），块⑤ 的框值就是默认值，且块内零 `.seg__item`', async () => {
    api.get.mockResolvedValue(view({ webdav: null }));
    await mount();
    await act(async () => { foldToggle('WebDAV 云端同步').click(); await Promise.resolve(); }); /* [V0.11.33] P1 前缀派生 aria */
    /* [V0.11.26] 载体分段整组删除（PRD 变更四 / O2）：块⑤ 里零分段按钮 */
    expect(container.querySelectorAll('[data-block="data-cloud"] .seg__item')).toHaveLength(0);
    /* 删了「选边」之后默认值必须**直接**在值里，否则用户看到的是两个空框 */
    const baseUrlInput = container.querySelector('input[placeholder="https://dav.jianguoyun.com/dav/"]') as HTMLInputElement;
    expect(baseUrlInput.value).toBe('https://dav.jianguoyun.com/dav/');
    const values = Array.from(container.querySelectorAll<HTMLInputElement>('[data-block="data-cloud"] input')).map((el) => el.value);
    expect(values).toContain('https://dav.jianguoyun.com/dav/');
    expect(values).toContain('/Timing');
  });

  it('E2 不回归：已配置过群晖地址时原样显示，默认值不出现', async () => {
    api.get.mockResolvedValue(view({
      webdav: {
        enabled: true,
        baseUrl: 'https://synology.example.com/dav/', basePath: '/Timing/md', user: 'me@example.com',
      },
    }));
    await mount();
    await act(async () => { foldToggle('WebDAV 云端同步').click(); await Promise.resolve(); });

    const values = Array.from(container.querySelectorAll<HTMLInputElement>('[data-block="data-cloud"] input')).map((el) => el.value);
    expect(values).toContain('https://synology.example.com/dav/');
    expect(values).toContain('/Timing/md');
    expect(values).not.toContain('https://dav.jianguoyun.com/dav/');
    expect(values).not.toContain('/Timing'); /* 精确元素比对：/Timing/md 不被默认值顶掉 */
  });
});

describe('R2：逐档手改与统一意图的先后（真 tab）', () => {
  beforeEach(beforeEachReset);
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('(a) 单框 D:\\md + 逐档把便利贴改成 D:\\manual → 其余两档吃下意图，单框不跳回', async () => {
    await mount();
    await setValue(input('日记落点根目录') as HTMLInputElement, 'D:\\md');
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    await setValue(input('便利贴落点根目录') as HTMLInputElement, 'D:\\manual');

    /* 手改那一刻：单框仍显示用户打的 D:\md（不许当场跳回 C:\Vault）；面板里其余两档已吃下意图 */
    expect(input('日记落点根目录')?.value).toBe('D:\\md');
    expect(input('事项计时落点根目录')?.value).toBe('D:\\md');
    expect(input('待办事项落点根目录')?.value).toBe('D:\\md');

    const saved = await save();
    expect(rootsOf(saved)).toEqual(['D:\\md', 'D:\\manual', 'D:\\md']);
  });

  it('(b) 反向守卫：没有统一意图时逐档手改绝不扇出', async () => {
    await mount();
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    await setValue(input('便利贴落点根目录') as HTMLInputElement, 'D:\\only');

    /* 另外两档在面板里必须一个字节都没动 */
    expect(input('事项计时落点根目录')?.value).toBe('C:\\Vault');
    expect(input('待办事项落点根目录')?.value).toBe('%APP_DIR%\\md');

    const saved = await save();
    expect(rootsOf(saved)).toEqual(['C:\\Vault', 'D:\\only', '%APP_DIR%\\md']);
  });

  it('(c) 跨字段不串：file 的意图不被 root 的手改固化，保存时仍三档统一', async () => {
    await mount();
    await setValue(input('日记文件名') as HTMLInputElement, '{date}-asd.md');
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    await setValue(input('便利贴落点根目录') as HTMLInputElement, 'D:\\manual');

    /* file 的意图还在：单框仍显示它（没被 root 的手改顺手清掉） */
    expect(input('日记文件名')?.value).toBe('{date}-asd.md');
    const saved = await save();
    expect(filesOf(saved)).toEqual(['{date}-asd.md', '{date}-asd.md', '{date}-asd.md']);
    /* root 没有意图 → 手改只影响那一档 */
    expect(rootsOf(saved)).toEqual(['C:\\Vault', 'D:\\manual', '%APP_DIR%\\md']);
  });

  it('(d) 固化之后「放弃修改」必须整体回滚（固化写进了 bindings，别让它绕过 discard）', async () => {
    await mount();
    await setValue(input('日记落点根目录') as HTMLInputElement, 'D:\\md');
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    await setValue(input('便利贴落点根目录') as HTMLInputElement, 'D:\\manual');
    /* 固化已经写进本地 bindings：此刻面板显示的是 D:\md / D:\manual / D:\md */
    expect(input('事项计时落点根目录')?.value).toBe('D:\\md');

    await act(async () => { button('放弃修改').click(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    /* 回滚到已保存的视图，三档一个都不许留着固化出来的值 */
    expect(input('日记落点根目录')?.value).toBe('C:\\Vault');
    expect(input('便利贴落点根目录')?.value).toBe('C:\\Vault2');
    expect(input('待办事项落点根目录')?.value).toBe('%APP_DIR%\\md');
    expect(container.querySelector('.data__dirty')).toBeNull();
  });
});

describe('R3 / R4：C11 按档数说话；备份时间只有一种格式', () => {
  beforeEach(beforeEachReset);
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  const c11Line = () => {
    const lines = Array.from(container.querySelectorAll('[data-block="data-root"] .data__note') ?? []);
    return lines.map((el) => el.textContent ?? '').join(' | ');
  };

  it('R3：affected 3 → 原句；2 → 点名两项；1 → 点名一项；0 → 整行不出现', async () => {
    rootApi.get.mockResolvedValue(dataRoot(['事项计时', '便利贴', '待办事项']));
    await mount();
    expect(c11Line()).toContain('这三档落点跟着数据根一起搬。');
    await act(async () => { root?.unmount(); });
    container.remove();

    rootApi.get.mockResolvedValue(dataRoot(['便利贴', '待办事项']));
    await mount();
    expect(c11Line()).toContain('便利贴、待办事项跟着数据根一起搬。');
    expect(container.textContent).not.toContain('这三档');
    await act(async () => { root?.unmount(); });
    container.remove();

    rootApi.get.mockResolvedValue(dataRoot(['待办事项']));
    await mount();
    expect(c11Line()).toContain('待办事项跟着数据根一起搬。');
    expect(container.textContent).not.toContain('这三档');
    await act(async () => { root?.unmount(); });
    container.remove();

    rootApi.get.mockResolvedValue(dataRoot([]));
    await mount();
    expect(container.textContent).not.toContain('跟着数据根一起搬');
  });

  it('R4：摘要行与列表首行同一格式（MM-DD HH:mm），整页无 YYYY/MM/DD', async () => {
    await mount();
    const summary = container.querySelector('[data-block="data-backup"] .sync__latest')?.textContent ?? '';
    expect(summary).toContain(formatAtShort(ITEMS[1].atMs));

    await act(async () => { foldToggle('备份数据管理').click(); await Promise.resolve(); });
    const firstFacts = container.querySelector('.sync-backup__row .sync-backup__facts')?.textContent ?? '';
    expect(firstFacts).toContain(formatAtShort(ITEMS[1].atMs));
    /* 两种格式不许同时出现：旧形态是 `2026/11/07 22:14` */
    expect(firstFacts).not.toContain('2026/11/07');
    expect(container.textContent ?? '').not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
    /* 摘要行与首行的时间片段必须逐字相同 */
    const time = formatAtShort(ITEMS[1].atMs);
    expect(summary.split(' · ')[0]).toBe(`最近：${time}`);
    expect(firstFacts.split(' · ')[2]).toBe(time);
  });
});
