/**
 * Timing — 三档控件的端到端判据（V0.11.19 批 1；[V0.11.26] 双通路收口）
 * -----------------------------------------------------------------------------
 * 走真 `MdSyncTab`（不拿替身 draft 自证）。纯函数那半已拆到 `mdSyncAutoPure.test.ts`
 * （300 行硬门禁，零豁免）。本文件只留 DOM 判据：
 *   C1 全页「同步间隔」/「MIN」/「1 分钟 ~ 24 小时」各 0 命中
 *   C2 老用户 `pollSecs=180`，只改云端后保存仍是 180
 *   D1 默认「智能」；D2 定时数字框；D3 关闭/智能不渲染数字框；H-2 切档不丢分钟数
 *   D5 两块各一份三档（R5）；D7 开关关掉 → 三档 disabled、值保留（O9 / O10）
 * 六块默认折叠（O4）：DOM 判据一律先 `openCloud()`。折叠体的 `hidden` 不影响
 * `querySelector` 命中，所以「不展开就断言」会得到一条假绿。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { AUTO_COPY } from './mdSyncCopy';

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

/** 块⑤ WebDAV 通路（老用户形状：**没有** `auto` 键，读作「智能 + 15」） */
const WEBDAV = {
  enabled: true,
  localRoot: '',
  baseUrl: 'https://dav.example.com/dav/',
  basePath: '/Timing',
  user: 'me@example.com',
};

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

/** 老用户：`pollSecs=180`，两条通路的配置里**都没有** `auto` 键。 */
function view(over: { pollSecs?: number; webdav?: MdSyncViewCloud['config']['cloudWebdav'] } = {}): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: {
      enabled: true,
      pollSecs: over.pollSecs ?? 180,
      bindings: BINDINGS,
      cloud: null,
      cloudFolder: null,
      cloudWebdav: over.webdav === undefined ? { ...WEBDAV } : over.webdav,
    },
    cloud: {
      enabled: true, mode: 'webdav', hasSecret: true, todayPushed: false,
      pendingDates: [], lastError: null,
    },
    local: {
      enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false,
      pendingDates: [], lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

/** 两次微任务：第一次让 `load()` 的 promise 落地，第二次让回填 effect 跑完。 */
async function mount(initial: MdSyncViewCloud = view()): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue(initial);
  api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({
    ...initial, config,
  }));
  await act(async () => {
    root.render(createElement(MdSyncTab));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

/** 展开块⑤（六块默认折叠，O4）：不展开的话下面的 `querySelector` 会命中折叠体里的旧节点 */
async function openCloud(): Promise<void> {
  const toggle = container.querySelector('button[aria-label="展开WebDAV 云端同步"]') as HTMLButtonElement | null;
  if (!toggle) throw new Error('块⑤ 的折叠按钮不见了');
  await act(async () => { toggle.click(); await Promise.resolve(); });
}

/** 块⑤ 的三档按钮（按块限定：块④ 也有同名的 `自动同步` 分组） */
function tiers(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll('[data-block="data-cloud"] [role="group"][aria-label="自动同步"] button'),
  ) as HTMLButtonElement[];
}

/**
 * 点块⑤ 里的按钮。**必须按块限定**：块④ 折叠着也挂在 DOM 里，`关闭` / `自动` /
 * `智能` / `测试连接` 这四个词两块都有，全页 `find` 会点到块④ 那个（它在 DOM 里靠前）。
 */
async function clickCloud(text: string): Promise<void> {
  const block = container.querySelector('[data-block="data-cloud"]') as HTMLElement | null;
  if (!block) throw new Error('块⑤ 不在 DOM 里');
  const found = Array.from(block.querySelectorAll('button')).find((el) => el.textContent === text);
  if (!found) throw new Error(`块⑤ 里找不到按钮：${text}`);
  await act(async () => { found.click(); await Promise.resolve(); });
}

/** 块⑤ 的可见文字（排除块④ 的同名文案：两块各有一份三档，不限定就会互相冒充） */
function cloudText(): string {
  return container.querySelector('[data-block="data-cloud"]')?.textContent ?? '';
}

function numberInput(): HTMLInputElement | null {
  return container.querySelector('[aria-label="云端自动同步周期（分钟）"]') as HTMLInputElement | null;
}

async function typeMinutes(value: string): Promise<void> {
  const input = numberInput();
  if (!input) throw new Error('定时档的数字框没有渲染');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function save(): Promise<MdSyncViewCloud['config']> {
  const before = api.save.mock.calls.length;
  await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
  expect(api.save.mock.calls.length).toBe(before + 1);
  return api.save.mock.calls[before][0] as MdSyncViewCloud['config'];
}

describe('MdSyncTab —— 三档控件与删掉的那一行', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test, api.open]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('C1：全页「同步间隔」/「MIN」/「1 分钟 ~ 24 小时」各 0 命中', async () => {
    await mount();
    await openCloud();
    const text = container.textContent ?? '';
    expect(text).not.toContain('同步间隔');
    expect(text).not.toContain('1 分钟 ~ 24 小时');
    expect(text).not.toContain('MIN');
    expect(container.querySelectorAll('.sync__interval')).toHaveLength(0);
    expect(container.querySelectorAll('.num-field__unit')).toHaveLength(0);
  });

  it('D1：三档默认「智能」，关闭档不配任何说明句', async () => {
    await mount();
    await openCloud();
    const items = tiers();
    expect(items.map((el) => el.textContent)).toEqual(['关闭', '自动', '智能']);
    expect(items.map((el) => el.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(cloudText()).toContain(AUTO_COPY.smartNote);
    expect(numberInput()).toBeNull();
    await clickCloud('关闭');
    expect(tiers()[0].getAttribute('aria-pressed')).toBe('true');
    expect(cloudText()).not.toContain(AUTO_COPY.smartNote);
    expect(cloudText()).not.toContain(AUTO_COPY.range);
  });

  it('D2 / D3：只有「自动」档渲染数字框（默认 15）与 5 ~ 120 分钟', async () => {
    await mount();
    await openCloud();
    await clickCloud('自动');
    const input = numberInput();
    expect(input?.value).toBe('15');
    expect(cloudText()).toContain(AUTO_COPY.range);
    expect(cloudText()).toContain(AUTO_COPY.every);
    expect(cloudText()).toContain(AUTO_COPY.minutes);
    await clickCloud('智能');
    expect(numberInput()).toBeNull();
    expect(cloudText()).not.toContain(AUTO_COPY.range);
  });

  it('D7（O9/O10）：关掉块⑤ 的开关 → 三档 disabled、值保留、控件不隐藏', async () => {
    await mount();
    await openCloud();
    await clickCloud('自动');
    /* 开关在标题右侧（`MdSyncTab` 的 actions 槽），点它只灰块⑤ 的三档 */
    const toggle = container.querySelector('[aria-label="启用云端同步"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); await Promise.resolve(); });

    for (const item of tiers()) expect(item.disabled).toBe(true);
    /* 值一个字节不清：关掉只是「别跑」，不是「别记着」（O10 不隐藏） */
    expect(tiers()[1].getAttribute('aria-pressed')).toBe('true');
    expect(numberInput()?.disabled).toBe(true);
    /* 块④ 的开关不受牵连（O13 互不触碰） */
    const folderToggle = container.querySelector('[aria-label="启用本地同步"]') as HTMLButtonElement;
    expect(folderToggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => { toggle.click(); await Promise.resolve(); });
    for (const item of tiers()) expect(item.disabled).toBe(false);
    expect(tiers()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('D5（R5）：两块各一份三档 —— 块⑤ 拨到自动 30 不会让块④ 跟着变', async () => {
    await mount();
    await openCloud();
    await clickCloud('自动');
    await typeMinutes('30');

    const folderGroup = container.querySelector(
      '[data-block="data-local"] [role="group"][aria-label="自动同步"]',
    ) as HTMLElement;
    const pressed = Array.from(folderGroup.querySelectorAll('button'))
      .map((el) => el.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'false', 'true']);
    /* 块④ 的分钟框 aria-label 与块⑤ 不同：同一屏两个「自动同步」必须分得清 */
    expect(container.querySelector('[aria-label="本地自动同步周期（分钟）"]')).toBeNull();

    const saved = await save();
    expect(saved.cloudWebdav?.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });
    /* 块④ 从未配置过 → `channelToSave` 归一成 `null`，不许长出带默认值的三档 */
    expect(saved.cloudFolder).toBeNull();
  });

  it('H-2：自动 30 → 智能 → 自动 → 保存，落库分钟数仍是 30', async () => {
    await mount();
    await openCloud();
    await clickCloud('自动');
    await typeMinutes('30');
    await clickCloud('智能');
    await clickCloud('自动');
    expect(numberInput()?.value).toBe('30');
    const saved = await save();
    expect(saved.cloudWebdav?.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });
  });

  it('C2：老用户 pollSecs=180，只改云端账号后保存仍是 180（视图未回来不许保存）', async () => {
    await mount();
    const saved = await save();
    expect(saved.pollSecs).toBe(180);
    api.test.mockResolvedValue({ ok: true, detail: '连接正常' });
    await openCloud();
    await clickCloud('测试连接');
    const tested = api.test.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(tested.pollSecs).toBe(180);
    /* 老配置没动过档位 → 不许凭空写出 auto 键 */
    expect(saved.cloudWebdav).not.toHaveProperty('auto');
  });

  it('视图丢失时点保存不落库（§15.2 的 `if (!view) return false` 守卫）', async () => {
    await mount();
    /* 视图被别处清空，但草稿里的 bindings 已回填 → 保存按钮仍是亮的，
       真正拦下这次保存的只能是 draft.save() 开头那一行守卫。 */
    await act(async () => {
      useMdSyncStore.setState({ view: null, loaded: false, loading: false });
      await Promise.resolve();
    });
    expect(button('保存并同步').disabled).toBe(false);
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
    expect(api.save).not.toHaveBeenCalled();
  });
});
