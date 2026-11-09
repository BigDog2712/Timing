/**
 * Timing — 块⑤「云端同步」卡 · 状态面用例（V0.11.26 拆分）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncWebdavCard.test.tsx`（300 行上限）拆出来的五条：E1/E2 默认值、
 * O9/O10 开关关、O15 两块不串行、往期清理四句。交互链（密码三分、三关、
 * resolvedBindings）留在原文件；夹具与那边同款，改一边必须改另一边。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdSyncApi: api,
  mdBackupApi: { list: vi.fn(), restore: vi.fn() },
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { MdSyncWebdavCard } from './MdSyncWebdavCard';
import { CLOUD_DIR_HINT } from './mdSyncCopy';
import { useMdSyncDraft } from './useMdSyncDraft';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function viewWith(patch: Partial<MdSyncViewCloud['config']> = {},
  status: { todayPushed?: boolean; localPushed?: boolean } = {}): MdSyncViewCloud {
  return {
    today: '2026-11-06',
    config: {
      enabled: true,
      pollSecs: 900,
      cloud: null,
      cloudFolder: null,
      cloudWebdav: {
        enabled: true,
        baseUrl: 'https://dav.example.com/dav/',
        basePath: '/Timing/md',
        user: 'me@example.com',
      },
      bindings: [{ kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' }],
      ...patch,
    },
    cloud: {
      enabled: true, mode: 'webdav', hasSecret: true, todayPushed: status.todayPushed ?? true,
      pendingDates: ['2026-11-04', '2026-11-05'], lastError: null,
    },
    /* 块④ 那一份：故意给相反的值，用来钉住「两块不串一行数字」 */
    local: {
      enabled: true, mode: 'localfolder', hasSecret: false, todayPushed: status.localPushed ?? false,
      pendingDates: [], lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

function Harness(): ReactElement {
  const draft = useMdSyncDraft();
  return createElement(MdSyncWebdavCard, { draft });
}

let container: HTMLDivElement; let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((i) => i.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

const statusBox = () => container.querySelector('.sync-cloud__status');

describe('MdSyncWebdavCard 状态面（块⑤）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.test]) fn.mockReset();
    api.get.mockResolvedValue(viewWith());
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('E1：从未配置过云端时，两个框的**值**（不是 placeholder）已预填', async () => {
    api.get.mockResolvedValue(viewWith({ cloudWebdav: null }));
    await mount();
    await act(async () => { await Promise.resolve(); });

    const urls = Array.from(container.querySelectorAll('input')).map((el) => el.value);
    expect(urls).toContain('https://dav.jianguoyun.com/dav/');
    expect(urls).toContain('/Timing');
    /* [V0.11.17] B3：远端目录框下有一行静态小字，逐字等于常量 */
    expect(container.textContent).toContain(CLOUD_DIR_HINT);
    /* 「值」而不是「灰字」：placeholder 是提示，用户必须先删掉才能填自己的 */
    const baseUrl = container.querySelector('input[placeholder="https://dav.jianguoyun.com/dav/"]') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://dav.jianguoyun.com/dav/');
  });

  it('E2：已配置过的地址原样显示，不被默认值改写', async () => {
    await mount();
    await act(async () => { await Promise.resolve(); });

    const urls = Array.from(container.querySelectorAll('input')).map((el) => el.value);
    expect(urls).toContain('https://dav.example.com/dav/');
    expect(urls).toContain('/Timing/md');
    expect(urls).not.toContain('https://dav.jianguoyun.com/dav/');
    expect(urls).not.toContain('/Timing');
  });

  it('O9 / O10：开关关着 → 字段 disabled 但**可见**，「测试连接」仍可点', async () => {
    api.get.mockResolvedValue(viewWith({
      cloudWebdav: {
        enabled: false, baseUrl: 'https://dav.example.com/dav/', basePath: '/Timing/md', user: 'me@example.com',
      },
    }));
    await mount();
    await act(async () => { await Promise.resolve(); });

    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((el) => el.disabled)).toBe(true);
    /* 关掉不隐藏：用户要能看到自己填过什么 */
    expect(container.textContent).toContain('服务地址');
    /* 只读探测不受开关拦（PRD §4.3 原样裁定） */
    expect(button('测试连接').disabled).toBe(false);
    /* 状态区整块收起：没在跑就不该说「今天还没上传」 */
    expect(statusBox()).toBeNull();
  });

  it('O15 数据面：状态行只读 `view.cloud`，`view.local` 的数字不串进来', async () => {
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(statusBox()?.getAttribute('data-channel')).toBe('webdav');
    expect(statusBox()?.textContent).toContain('今天已上传');

    /* 反过来再验一次：云端没传、本地传过 → 块⑤ 仍说「今天还没上传」 */
    await act(async () => { root.unmount(); });
    container.remove();
    api.get.mockResolvedValue(viewWith({}, { todayPushed: false, localPushed: true }));
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(statusBox()?.textContent).toContain('今天还没上传');
  });

  /* [V0.11.19 变更 A] 块④ 那一行只读文字：四句选择器在 `mdSyncAuto.ts`，这里钉
     「状态真的接到界面上」；没接上时它永远是常态句（T03 刻意留的那一档）。 */
  it('往期清理只在 ready 分支里显示一行，且四句按状态选', async () => {
    const idle = '云端只保留今天的日记，更早的会在同步后删除。';
    await mount();
    await act(async () => { await Promise.resolve(); });
    const line = () => container.querySelector('[data-purge="true"]')?.textContent;
    expect(line()).toBe(idle);

    const view = viewWith();
    api.get.mockResolvedValue({ ...view,
      cloud: { ...view.cloud, purge: { paused: false, deleted: 5, failed: 0 } } });
    await act(async () => { root.unmount(); });
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(line()).toBe('云端只保留今天的日记；上次清理删了 5 份。');

    /* 没填全的那一档不叠加这一行（「云端还没填全」只显示它自己那句） */
    api.get.mockResolvedValue(viewWith({
      cloudWebdav: {
        enabled: true, baseUrl: '', basePath: '/Timing/md', user: 'me@example.com',
      },
    }));
    await act(async () => { root.unmount(); });
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(line()).toBeUndefined();
  });
});
