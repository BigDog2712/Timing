/**
 * Timing — 批 1 · 三档控件与「同步间隔」整行删除的端到端判据
 * -----------------------------------------------------------------------------
 * 走真 `MdSyncTab`（不拿替身 draft 自证），覆盖 12-PRD §3.3 / §3.4 / §15.2：
 *   C1 全页「同步间隔」/「MIN」/「1 分钟 ~ 24 小时」各 0 命中
 *   C2 老用户 `pollSecs=180` 只改云端账号后保存仍是 180
 *   D1 默认「智能」；D2 定时数字框的范围与夹值；D3 关闭/智能不渲染数字框
 *   D7 通道切到「只用本地」→ 三档 disabled 且值保留
 *   H-2 定时 30 → 智能 → 定时 保存，分钟数仍是 30
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import {
  AUTO_MAX_MINUTES,
  AUTO_MIN_MINUTES,
  autoOf,
  clampAutoMinutes,
  defaultAuto,
  purgeNoteOf,
  withSchedule,
} from './mdSyncAuto';
import { AUTO_COPY, PURGE_COPY, REMOVED_PHRASES } from './mdSyncCopy';

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

const CLOUD = {
  enabled: true,
  mode: 'webdav' as const,
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

/** 老用户：`pollSecs=180`，`cloud` 里**没有** `auto` 键。 */
function view(over: { pollSecs?: number; cloud?: MdSyncViewCloud['config']['cloud'] } = {}): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: {
      enabled: true,
      pollSecs: over.pollSecs ?? 180,
      bindings: BINDINGS,
      cloud: over.cloud === undefined ? { ...CLOUD } : over.cloud,
    },
    cloud: {
      enabled: true, mode: 'webdav', hasSecret: true, todayPushed: false,
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

async function click(text: string): Promise<void> {
  await act(async () => { button(text).click(); await Promise.resolve(); });
}

function tiers(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll('[role="group"][aria-label="自动同步"] button'),
  ) as HTMLButtonElement[];
}

function numberInput(): HTMLInputElement | null {
  return container.querySelector('[aria-label="云端自动同步间隔（分钟）"]') as HTMLInputElement | null;
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

describe('mdSyncAuto —— 纯函数', () => {
  it('老配置缺 auto → 智能 + 15；坏值收敛，不写回', () => {
    expect(defaultAuto()).toEqual({ schedule: 'smart', intervalMinutes: 15 });
    expect(autoOf(undefined)).toEqual(defaultAuto());
    expect(autoOf(null)).toEqual(defaultAuto());
    expect(autoOf({ schedule: 'off', intervalMinutes: 999 }))
      .toEqual({ schedule: 'off', intervalMinutes: AUTO_MAX_MINUTES });
  });

  it('D2：1 → 5，999 → 120，非数字回 15', () => {
    expect(clampAutoMinutes('1')).toBe(AUTO_MIN_MINUTES);
    expect(clampAutoMinutes('999')).toBe(AUTO_MAX_MINUTES);
    expect(clampAutoMinutes('')).toBe(15);
    expect(clampAutoMinutes('abc')).toBe(15);
    expect(clampAutoMinutes('30')).toBe(30);
  });

  it('H-2：切档只改 schedule，分钟数原样带过', () => {
    const auto = { schedule: 'interval' as const, intervalMinutes: 30 };
    expect(withSchedule(auto, 'smart')).toEqual({ schedule: 'smart', intervalMinutes: 30 });
    expect(auto.intervalMinutes).toBe(30);
  });

  it('四句清理文案的优先级与逐字（T04 接状态前先钉住选择器）', () => {
    expect(purgeNoteOf(undefined)).toBe(PURGE_COPY.idle);
    expect(purgeNoteOf({ paused: true, deleted: 9, failed: 4 }))
      .toBe('往期清理已暂停：4 份没能删掉。点「立即同步」重试。');
    expect(purgeNoteOf({ paused: false, deleted: 0, failed: 3 }))
      .toBe('云端只保留今天的日记；有 3 份往期没能删掉，下一轮再试。');
    expect(purgeNoteOf({ paused: false, deleted: 2, failed: 0 }))
      .toBe('云端只保留今天的日记；上次清理删了 2 份。');
    expect(purgeNoteOf({ paused: false, deleted: 0, failed: 0 })).toBe(PURGE_COPY.idle);
  });

  it('三档文案逐字表（§11.1）', () => {
    expect(AUTO_COPY).toEqual({
      label: '自动同步', off: '关闭', interval: '定时', smart: '智能',
      every: '每', minutes: '分钟', range: '5 ~ 120 分钟',
      smartNote: '停手 5 分钟后同步；启动时一次。',
    });
    expect(REMOVED_PHRASES).toContain('同步间隔');
    expect(REMOVED_PHRASES).toContain('1 分钟 ~ 24 小时');
  });
});

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
    const text = container.textContent ?? '';
    expect(text).not.toContain('同步间隔');
    expect(text).not.toContain('1 分钟 ~ 24 小时');
    expect(text).not.toContain('MIN');
    expect(container.querySelectorAll('.sync__interval')).toHaveLength(0);
    expect(container.querySelectorAll('.num-field__unit')).toHaveLength(0);
  });

  it('D1：三档默认「智能」，关闭档不配任何说明句', async () => {
    await mount();
    const items = tiers();
    expect(items.map((el) => el.textContent)).toEqual(['关闭', '定时', '智能']);
    expect(items.map((el) => el.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(container.textContent).toContain(AUTO_COPY.smartNote);
    expect(numberInput()).toBeNull();
    await click('关闭');
    expect(tiers()[0].getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain(AUTO_COPY.smartNote);
    expect(container.textContent).not.toContain(AUTO_COPY.range);
  });

  it('D2 / D3：只有「定时」渲染数字框（默认 15）与 5 ~ 120 分钟', async () => {
    await mount();
    await click('定时');
    const input = numberInput();
    expect(input?.value).toBe('15');
    expect(container.textContent).toContain(AUTO_COPY.range);
    expect(container.textContent).toContain(AUTO_COPY.every);
    expect(container.textContent).toContain(AUTO_COPY.minutes);
    await click('智能');
    expect(numberInput()).toBeNull();
    expect(container.textContent).not.toContain(AUTO_COPY.range);
  });

  it('D7：切到「只用本地」→ 三档 disabled，值保留（切回仍是原档）', async () => {
    await mount();
    await click('定时');
    await click('只用本地');
    for (const item of tiers()) expect(item.disabled).toBe(true);
    expect(tiers()[1].getAttribute('aria-pressed')).toBe('true');
    await click('本地 + 云端');
    for (const item of tiers()) expect(item.disabled).toBe(false);
    expect(tiers()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('H-2：定时 30 → 智能 → 定时 → 保存，落库分钟数仍是 30', async () => {
    await mount();
    await click('定时');
    await typeMinutes('30');
    await click('智能');
    await click('定时');
    expect(numberInput()?.value).toBe('30');
    const saved = await save();
    expect(saved.cloud?.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });
  });

  it('C2：老用户 pollSecs=180，只改云端账号后保存仍是 180（视图未回来不许保存）', async () => {
    await mount();
    const saved = await save();
    expect(saved.pollSecs).toBe(180);
    api.test.mockResolvedValue({ ok: true, detail: '连接正常' });
    await click('测试连接');
    const tested = api.test.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(tested.pollSecs).toBe(180);
    /* 老配置没动过档位 → 不许凭空写出 auto 键 */
    expect(saved.cloud).not.toHaveProperty('auto');
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
