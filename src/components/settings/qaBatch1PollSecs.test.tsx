/**
 * [QA 独立复验 V0.11.19 批 1] 重点区 1：`pollSecs` 透传的**落库 + 回读**独立证据。
 * -----------------------------------------------------------------------------
 * 不复用 `mdSyncAuto.test.tsx` 的断言，也不测纯函数：自己走一遍
 *   MdSyncTab → useMdSyncDraft.save() → useMdSyncStore.save() → mdSyncApi.save
 * 并把「改档位」和「pollSecs 透传」叠在同一帧里 —— 改档位会触发 `patch({...cloud, auto})`
 * 重建 cloud 对象，正是最容易顺手把 `pollSecs` 丢成兜底值 900 的那一刻。
 *
 * 断言的是**发给后端的那份 config**（落库参数）与**保存后 store 里的 view**（回读），
 * 不是 `defaultAuto()` / `clampAutoMinutes()` 这类纯函数的自证。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

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

/** 老用户：界面里已经没有入口的 pollSecs=180，cloud 里没有 auto 键。 */
function oldView(): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: {
      enabled: true,
      pollSecs: 180,
      bindings: BINDINGS,
      cloud: {
        enabled: true,
        mode: 'webdav',
        localRoot: '',
        baseUrl: 'https://dav.example.com/dav/',
        basePath: '/Timing',
        user: 'me@example.com',
      },
    },
    cloud: {
      enabled: true, mode: 'webdav', hasSecret: true, todayPushed: false,
      pendingDates: [], lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

let container: HTMLDivElement;
let root: Root;

async function mount(initial: MdSyncViewCloud): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue(initial);
  /* 后端保存成功后回的新视图 = 原视图 + 刚落库的 config。store 会把它 set 回 view。 */
  api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...initial, config }));
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

async function save(): Promise<MdSyncViewCloud['config']> {
  const before = api.save.mock.calls.length;
  await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
  expect(api.save.mock.calls.length, '保存必须真的落到 mdSyncApi.save').toBe(before + 1);
  return api.save.mock.calls[before][0] as MdSyncViewCloud['config'];
}

async function typeMinutes(value: string): Promise<void> {
  const input = container.querySelector('[aria-label="云端自动同步间隔（分钟）"]') as HTMLInputElement | null;
  if (!input) throw new Error('定时档的数字框没有渲染');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('QA 批 1 · pollSecs 落库与回读', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test, api.open]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue({
      current: 'D:\\Timing\\data', defaultPath: '', isDefault: false, writable: true,
      writableError: null, pending: null, previous: null, sizeBytes: 0, entries: [],
      affected: [], pluginsInDataRoot: false,
    });
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('改档位 + 保存 + 回读 + 二次保存：pollSecs 始终是 180，不是 900 也不是 15', async () => {
    const initial = oldView();
    await mount(initial);

    /* 改成定时 30：这一步会重建 cloud（写 auto），是 pollSecs 最容易丢的一帧。 */
    await click('定时');
    await typeMinutes('30');
    const saved = await save();

    expect(saved.pollSecs).toBe(180);
    expect(saved.pollSecs).not.toBe(900);
    expect(saved.pollSecs).not.toBe(15);
    expect(saved.cloud?.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });

    /* 回读：store 里的 view 是后端返回的那一份，pollSecs 必须原样带回来。 */
    const reread = useMdSyncStore.getState().view;
    expect(reread?.config.pollSecs).toBe(180);

    /* 视图回来后再存一次（回填 effect 已跑），仍不许退化成兜底值。 */
    const savedAgain = await save();
    expect(savedAgain.pollSecs).toBe(180);
    expect(savedAgain.cloud?.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });
  });

  it('视图未回来时点保存不落库，且不许把 900 占位写进去', async () => {
    await mount(oldView());
    await act(async () => {
      useMdSyncStore.setState({ view: null, loaded: false, loading: false });
      await Promise.resolve();
    });
    expect(button('保存并同步').disabled).toBe(false);
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
    expect(api.save).not.toHaveBeenCalled();
  });
});
