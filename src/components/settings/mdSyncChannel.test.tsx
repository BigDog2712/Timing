import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncCloudChannel, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { REMOVED_PHRASES } from './mdSyncCopy';

/* [V0.11.26] 本文件原来是「存储通道二选一」的界面判据（PRD A1 组）。
   通道选择器整组退场后（PRD 变更一），它改造为**块开关**的判据（O8–O10 / O13）：

   - 三个开关各管各的通路，aria-label 逐字（O8）；
   - 关掉某一块 → 该块可写控件 `disabled` 但**仍在 DOM**，「测试连接」仍可点（O9 / O10）；
   - 只改一块再保存，另一块的三件套一个字节不动（O13）。

   纯函数那一层在 `mdSyncConfig.test.ts`，这里只证明「界面上真的用上了它们」。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 待办事项' },
];

const FOLDER: MdSyncCloudChannel = {
  enabled: true,
  localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD',
};

const WEBDAV: MdSyncCloudChannel = {
  enabled: true,
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: 'me@example.com',
};

/** 主人真实配置的形状：两条通路都配过、都开着。 */
function view(
  folder: MdSyncCloudChannel | null = FOLDER,
  webdav: MdSyncCloudChannel | null = WEBDAV,
): MdSyncViewCloud {
  const status = (enabled: boolean) => ({
    enabled,
    mode: 'webdav' as const,
    hasSecret: false,
    todayPushed: false,
    pendingDates: [],
    lastError: null,
  });
  return {
    today: '2026-11-26',
    config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud: null, cloudFolder: folder, cloudWebdav: webdav },
    cloud: status(webdav?.enabled ?? false),
    local: status(folder?.enabled ?? false),
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

/** 六块默认全折叠（O4）：要验块内控件必须先把它展开。 */
async function openBlock(id: string): Promise<void> {
  const head = container.querySelector(`[data-block="${id}"] .data__block-head`);
  const toggle = head?.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
  if (!toggle) throw new Error(`块 ${id} 没有折叠按钮`);
  if (toggle.getAttribute('aria-expanded') === 'false') {
    await act(async () => { toggle.click(); await Promise.resolve(); });
  }
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdSyncTab));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
  await openBlock('data-local');
  await openBlock('data-cloud');
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

const localInputs = () =>
  Array.from(container.querySelectorAll('[data-block="data-local"] input')) as HTMLInputElement[];
const webdavInputs = () =>
  Array.from(container.querySelectorAll('[data-block="data-cloud"] input')) as HTMLInputElement[];
const switchOf = (label: string) =>
  container.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLButtonElement;

/** 全页可见文本 + 每处 `title` / `aria-label`（PRD F6 要求这三处都搜） */
function allText(): string {
  const parts = [container.textContent ?? ''];
  for (const el of Array.from(container.querySelectorAll('[title]'))) parts.push(el.getAttribute('title') ?? '');
  for (const el of Array.from(container.querySelectorAll('[aria-label]'))) parts.push(el.getAttribute('aria-label') ?? '');
  return parts.join('\n');
}

describe('块开关（O8–O10 / O13）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
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

  it('O8：全页恰好 3 个开关，aria-label 逐字「启用 Markdown 同步 / 启用本地同步 / 启用云端同步」', async () => {
    await mount();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches).toHaveLength(3);
    expect(switches.map((el) => el.getAttribute('aria-label'))).toEqual([
      '启用 Markdown 同步', '启用本地同步', '启用云端同步',
    ]);
  });

  it('O9：关掉「启用本地同步」→ 块④ 控件全 disabled 且仍在 DOM，「测试连接」仍可点', async () => {
    await mount();
    expect(localInputs().some((el) => el.disabled)).toBe(false);
    await act(async () => { switchOf('启用本地同步').click(); await Promise.resolve(); });

    const inputs = localInputs();
    expect(inputs.length).toBeGreaterThan(0);
    for (const el of inputs) {
      expect(el.disabled).toBe(true);
      /* 变灰、不隐藏（A5 平移）：不是从树上摘掉 */
      expect(el.isConnected).toBe(true);
    }
    expect(button('测试连接').disabled).toBe(false, );
    /* 三档也 disabled，但值还在（D7 平移） */
    const tiers = Array.from(container.querySelectorAll('[data-block="data-local"] [data-tier]')) as HTMLButtonElement[];
    expect(tiers.length).toBe(3);
    for (const el of tiers) expect(el.disabled).toBe(true);
  });

  it('O10：关掉「启用云端同步」→ 块⑤ 控件 + 「清除密码」全 disabled，「测试连接」仍可点', async () => {
    await mount();
    await act(async () => { switchOf('启用云端同步').click(); await Promise.resolve(); });
    for (const el of webdavInputs()) {
      expect(el.disabled).toBe(true);
      expect(el.isConnected).toBe(true);
    }
    expect(button('清除密码').disabled).toBe(true);
    expect(button('测试连接').disabled).toBe(false);
  });

  it('O11/O12：打开页签**读盘零写**（md_sync_get 一次，save 零次），两块各自回填自己的值', async () => {
    await mount();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
    /* 本地落点在块④，三件套在块⑤——两块各读自己那份，没有「选边」这回事 */
    const local = container.querySelector('[aria-label="本地同步落点目录"]') as HTMLInputElement;
    expect(local.value).toBe(FOLDER.localRoot);
    expect(webdavInputs()[1].value).toBe('/Timing');
  });

  it('O13：只改块④ 再保存 → 块⑤ 的三件套与开关一个字节不动', async () => {
    await mount();
    const input = container.querySelector('[aria-label="本地同步落点目录"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'D:\\md2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.cloudFolder).toEqual({ ...FOLDER, localRoot: 'D:\\md2' });
    expect(saved.cloudWebdav).toEqual(WEBDAV);
    /* 新保存形里 legacy `cloud` 键不出现（O11）：载荷里它是 null */
    expect(saved.cloud ?? null).toBeNull();
  });

  it('O13 后半句：两块都从未配置且都关 → 两条通路都落 null（与新装同形）', async () => {
    api.get.mockResolvedValue(view(null, null));
    await mount();
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.cloudFolder).toBeNull();
    expect(saved.cloudWebdav).toBeNull();
  });

  /* ===== 文案判据（O2 / F6）===== */

  it('O2：全页零命中已删文案（含 title / aria-label，通道分段与载体分段都不许回来）', async () => {
    await mount();
    const text = allText();
    for (const phrase of REMOVED_PHRASES) expect(text).not.toContain(phrase);
  });

  it('F6：数据管理页签搜「汇总」0 命中（折叠态与展开态各一次）', async () => {
    await mount();
    expect(allText()).not.toContain('汇总');
    const tiers = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '逐个设置');
    if (tiers) await act(async () => { tiers.click(); await Promise.resolve(); });
    expect(allText()).not.toContain('汇总');
  });
});
