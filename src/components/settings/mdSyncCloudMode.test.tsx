import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MdSyncCloudChannel,
  MdSyncCloudStatus,
  MdSyncConfig,
  MdSyncTestResult,
  MdSyncViewCloud,
} from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [V0.11.26] 原「测试连接与状态行跟随 mode」（PRD A7 / A8）在拆分后变成**两块各自**的判据
   （O14 / O15）：

   1. 两块各有一个「测试连接」——块④ 走 detail 退回路径（`probe` 对 localfolder 回空 `steps`），
      块⑤ 走三关逐步点亮；
   2. 状态行各读各的：块④ 读 `view.local`（**不出现密码句**——`has_secret` 恒读 KEY_WEBDAV，
      对本地通路是错话），块⑤ 读 `view.cloud`；
   3. 「没填全」两句话各归各块，且**只显示一句**（A6c 口径平移）。
   4. 两块各自持有 `testResult` state → 结果天然互不残留（O15）。

   真根因仍然在界面层，`probe.rs` 零 diff：块④ 用它现拼的 legacy `localfolder` 载荷。 */

const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({ mdSyncApi: api, mdBackupApi: { list: vi.fn(), restore: vi.fn() } }));

import { MdSyncLocalCard } from './MdSyncLocalCard';
import { MdSyncWebdavCard } from './MdSyncWebdavCard';
import { useMdSyncDraft } from './useMdSyncDraft';
import type { MdSyncDraft } from './useMdSyncDraft';
import { createMockApiPlugins } from '../../mocks/browserMockPlugins';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function statusOf(enabled: boolean, over: Partial<MdSyncCloudStatus> = {}): MdSyncCloudStatus {
  return {
    enabled,
    mode: 'webdav',
    hasSecret: false,
    todayPushed: false,
    pendingDates: [],
    lastError: null,
    ...over,
  };
}

function viewWith(
  folder: MdSyncCloudChannel,
  webdav: MdSyncCloudChannel,
  over: { local?: Partial<MdSyncCloudStatus>; cloud?: Partial<MdSyncCloudStatus> } = {},
): MdSyncViewCloud {
  return {
    today: '2026-11-26',
    config: {
      enabled: true,
      pollSecs: 900,
      cloud: null,
      bindings: [{ kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' }],
      cloudFolder: folder,
      cloudWebdav: webdav,
    },
    local: statusOf(folder.enabled, over.local),
    cloud: statusOf(webdav.enabled, over.cloud),
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

const LOCAL: MdSyncCloudChannel = { enabled: true, localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD' };
const WEBDAV: MdSyncCloudChannel = {
  enabled: true,
  baseUrl: 'https://dav.example.com/dav/',
  basePath: '/Timing/md',
  user: 'me@example.com',
};

/** 真 Hook + 真卡：判据看的是「界面按通路分派了什么」，假 draft 会绕开回填。 */
function harnessOf(Card: (props: { draft: MdSyncDraft }) => ReactElement) {
  return function Harness(): ReactElement {
    const draft: MdSyncDraft = useMdSyncDraft();
    return createElement(Card, { draft });
  };
}

let container: HTMLDivElement; let root: Root;

async function mount(Card: (props: { draft: MdSyncDraft }) => ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const Harness = harnessOf(Card);
  await act(async () => {
    root.render(createElement(Harness));
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

const result = () => container.querySelector('.sync-cloud__result');
const statusBox = () => container.querySelector('.sync-cloud__status');

describe('两块各自的测试连接与状态行（O14 / O15）', () => {
  beforeEach(() => {
    host.mobile = false;
    for (const fn of [api.get, api.save, api.test]) fn.mockReset();
    api.get.mockResolvedValue(viewWith(LOCAL, WEBDAV));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('B2a → O15：块④ 有「测试连接」且可点，载荷是 legacy `localfolder`（`enabled` 恒 true）', async () => {
    await mount(MdSyncLocalCard);
    const test = button('测试连接');
    expect(test.disabled).toBe(false);
    await click('测试连接');
    const payload = api.test.mock.calls[0][0] as MdSyncConfig;
    expect(payload.cloud?.mode).toBe('localfolder');
    expect(payload.cloud?.localRoot).toBe(LOCAL.localRoot);
    expect(payload.cloud?.enabled).toBe(true);
  });

  it('B2b：块④ 的结论只显示一句「目录可写：…」，不渲染三关（steps 为空）', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '目录可写：D:\\Nutstore\\我的坚果云\\TimingMD' });
    await mount(MdSyncLocalCard);
    await click('测试连接');

    expect(result()?.textContent).toBe('目录可写：D:\\Nutstore\\我的坚果云\\TimingMD');
    expect(result()?.getAttribute('data-ok')).toBe('true');
    expect(result()?.querySelector('.sync-cloud__steps')).toBeNull();
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('B2c：块④ 状态行**不出现**密码句（`has_secret` 恒读 KEY_WEBDAV，对本地是错话）', async () => {
    await mount(MdSyncLocalCard);
    expect(container.textContent).not.toContain('密码未设置');
    expect(container.textContent).not.toContain('密码已保存');
    expect(container.textContent).toContain('今天还没上传');
    expect(statusBox()?.getAttribute('data-channel')).toBe('folder');
  });

  it('B2d：块⑤ 状态行仍显示密码项，且读的是 `view.cloud`', async () => {
    await mount(MdSyncWebdavCard);
    expect(container.textContent).toContain('密码未设置');
    expect(statusBox()?.getAttribute('data-channel')).toBe('webdav');
  });

  it('O15：块⑤ 测出红字后换挂块④ → 结果不残留（两块各自持有 testResult）', async () => {
    api.test.mockResolvedValueOnce({
      ok: false,
      detail: '账号或应用密码不对',
      steps: [{ key: 'account', ok: false, detail: '账号或应用密码不对' }],
    });
    await mount(MdSyncWebdavCard);
    await click('测试连接');
    expect(result()?.querySelector('.sync-cloud__steps')?.textContent).toBe('账号 ✗');

    await act(async () => { root.unmount(); });
    container.remove();
    await mount(MdSyncLocalCard);
    expect(result()).toBeNull();
  });

  it('B2f：浏览器 mock 与真机 `probe.rs` 同序（`enabled` 不参与判定）', () => {
    const handlers = createMockApiPlugins();
    const test = handlers.md_sync_test as (args: unknown) => MdSyncTestResult;
    const base: MdSyncConfig = { enabled: true, pollSecs: 900, bindings: [], cloud: null };

    /* `cloud === null` → 报「还没配置云端通道」（与 probe.rs 同一句） */
    expect(test({ config: base })).toEqual({ ok: false, detail: '还没配置云端通道' });

    /* `enabled: false` + localfolder → **绿字**：真机 LocalFolder 分支不看 `enabled`。 */
    const localfolder = {
      enabled: false, mode: 'localfolder' as const, localRoot: 'D:\\md',
      baseUrl: '', basePath: '', user: '',
    };
    expect(test({ config: { ...base, cloud: localfolder } }))
      .toEqual({ ok: true, detail: '目录可写：D:\\md' });
  });

  /* ===== O14：两块各自的「没填全」，且**只显示一句** ===== */

  it('O14 块⑤：缺地址与账号 → 逐字「云端还没填全，暂时不会同步。」且不叠加其它状态', async () => {
    api.get.mockResolvedValue(viewWith(LOCAL, { ...WEBDAV, baseUrl: '', user: '' }));
    await mount(MdSyncWebdavCard);

    expect(container.textContent).toContain('云端还没填全，暂时不会同步。');
    expect(container.querySelector('[data-missing="true"]')).not.toBeNull();
    expect(statusBox()?.getAttribute('data-ready')).toBe('false');
    expect(container.textContent).not.toContain('今天还没上传');
    expect(container.textContent).not.toContain('密码已保存');
  });

  it('O14 块④：落点目录是空白 → 逐字「云端目录还没填，暂时不会同步。」（L4），块⑤ 不受影响', async () => {
    api.get.mockResolvedValue(viewWith({ ...LOCAL, localRoot: '   ' }, WEBDAV));
    await mount(MdSyncLocalCard);

    expect(container.textContent).toContain('云端目录还没填，暂时不会同步。');
    expect(container.querySelector('[data-missing="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('今天还没上传');
    /* 块⑤ 那份状态在这里根本不该被读（同一份 view 下它是「填全」） */
    expect(statusBox()?.getAttribute('data-ready')).toBe('false');
  });

  it('A6c：填全之后那句话消失，回到正常状态行', async () => {
    await mount(MdSyncWebdavCard);
    expect(container.textContent).not.toContain('云端还没填全，暂时不会同步。');
    expect(statusBox()?.getAttribute('data-ready')).toBe('true');
    expect(container.textContent).toContain('今天还没上传');
  });
});
