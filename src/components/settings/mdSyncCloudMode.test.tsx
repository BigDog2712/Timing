import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudMode, MdSyncCloud, MdSyncCloudStatus, MdSyncConfig, MdSyncTestResult, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [V0.11.18] T2「测试连接与状态行跟随 mode」的判据（PRD A7 / A8 / §13.4.2）。

   单独一个文件而不是往 `MdSyncCloudCard.test.tsx` 里塞：那个文件已经 272 行
   （`check:size` 是 300 行硬门禁、零豁免），而这一批断言要 60+ 行。

   真根因在**界面层**两处，不在 `probe`：
   1. 「测试连接」原来只长在 WebDAV 分支里 → localfolder 用户没有自证入口；
   2. 状态行的「密码」是 WebDAV 语义硬编码（`state.rs` 的 `has_secret` 无条件读
      `KEY_WEBDAV`）→ localfolder 用户恒定看到「密码未设置」。 */

const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({ mdSyncApi: api, mdBackupApi: { list: vi.fn(), restore: vi.fn() } }));

import { MdSyncCloudCard } from './MdSyncCloudCard';
import { useMdSyncDraft } from './useMdSyncDraft';
import type { MdSyncDraft } from './useMdSyncDraft';
import { createMockApiPlugins } from '../../mocks/browserMockPlugins';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function viewWith(
  mode: CloudMode,
  over: Partial<MdSyncCloudStatus> = {},
  /* [V0.11.18] A6 要造「开了但没填全」那一档：默认是填全的，按需抹掉字段。 */
  cloudOver: Partial<MdSyncCloud> = {},
): MdSyncViewCloud {
  const cloud = {
    enabled: true, mode,
    localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD',
    baseUrl: 'https://dav.example.com/dav/', basePath: '/Timing/md', user: 'me@example.com',
    ...cloudOver,
  };
  return {
    today: '2026-11-18',
    config: {
      enabled: true, pollSecs: 900, cloud,
      bindings: [{ kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' }],
    },
    /* `hasSecret` 这里刻意给 `false`：真实 localfolder 用户从没存过 WebDAV 应用密码，
       而那正是「密码未设置」那句错话的来源。 */
    cloud: {
      enabled: true, mode, hasSecret: false, todayPushed: false, pendingDates: [], lastError: null, ...over,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

function Harness(): ReactElement {
  /* 真 Hook + 真卡：这一批判据看的是「界面按 mode 分派了什么」，
     用假 draft 会绕开 `useMdSyncDraft` 的回填（`mode` 就是回填出来的那个值）。 */
  const draft: MdSyncDraft = useMdSyncDraft();
  return createElement(MdSyncCloudCard, { draft });
}

let container: HTMLDivElement; let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

describe('测试连接与状态行跟随 mode（T2 / PRD A7 / A8）', () => {
  beforeEach(() => {
    host.mobile = false;
    for (const fn of [api.get, api.save, api.test]) fn.mockReset();
    api.get.mockResolvedValue(viewWith('localfolder'));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('B2a：载体是本地目录时「测试连接」**在 DOM 里且可点**', async () => {
    await mount();
    expect(container.textContent).toContain('落点目录');
    const test = button('测试连接');
    expect(test.disabled).toBe(false);
  });

  it('B2b：点它只显示一句「目录可写：…」，不渲染三关（steps 为空）', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '目录可写：D:\\Nutstore\\我的坚果云\\TimingMD' });
    await mount();
    await click('测试连接');

    expect(result()?.textContent).toBe('目录可写：D:\\Nutstore\\我的坚果云\\TimingMD');
    expect(result()?.getAttribute('data-ok')).toBe('true');
    /* localfolder 的 `probe` 返回 `steps: Vec::new()` → 走「只显示 detail」那条退回路径 */
    expect(result()?.querySelector('.sync-cloud__steps')).toBeNull();
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('B2c：localfolder + 密码未设置 + 无 lastError → 界面**零红字**', async () => {
    await mount();
    expect(container.querySelector('.sync__error')).toBeNull();
    expect(container.querySelector('[data-ok="false"]')).toBeNull();
    expect(container.querySelector('.sync-cloud__status')?.getAttribute('data-mode')).toBe('localfolder');
  });

  it('B2d：localfolder 下状态行**不出现**「密码未设置 / 密码已保存」；WebDAV 下仍在', async () => {
    await mount();
    expect(container.textContent).not.toContain('密码未设置');
    expect(container.textContent).not.toContain('密码已保存');
    /* 「今天已上传」不门控（localfolder 也走同一条 `mark_synced` 落库路径） */
    expect(container.textContent).toContain('今天还没上传');

    await click('WebDAV');
    expect(container.textContent).toContain('密码未设置');
  });

  it('A8：WebDAV 上点出红字 → 切到本地目录 → 红字**立刻消失**；切回也不复活', async () => {
    api.get.mockResolvedValue(viewWith('webdav', { hasSecret: true }));
    api.test.mockResolvedValueOnce({
      ok: false,
      detail: '账号或应用密码不对',
      steps: [{ key: 'account', ok: false, detail: '账号或应用密码不对' }],
    });
    await mount();
    await click('测试连接');
    expect(result()?.querySelector('.sync-cloud__steps')?.textContent).toBe('账号 ✗');

    await click('本地目录');
    expect(result()).toBeNull();

    await click('WebDAV');
    expect(result()).toBeNull();
  });

  it('B2f：浏览器 mock 与真机 `probe.rs` 同序（`enabled` 不参与判定）', () => {
    const handlers = createMockApiPlugins();
    const test = handlers.md_sync_test as (args: unknown) => MdSyncTestResult;
    const base: MdSyncConfig = { enabled: true, pollSecs: 900, bindings: [], cloud: null };

    /* `cloud === null` → 报「还没配置云端通道」（与 probe.rs:44 同一句） */
    expect(test({ config: base })).toEqual({ ok: false, detail: '还没配置云端通道' });

    /* `enabled: false` + localfolder → **绿字**。真机 LocalFolder 分支不看 `enabled`；
       mock 以前先判 `enabled` 直接报红，于是走查看到红、实机看到绿。 */
    const localfolder = {
      enabled: false, mode: 'localfolder' as const, localRoot: 'D:\\md',
      baseUrl: '', basePath: '', user: '',
    };
    expect(test({ config: { ...base, cloud: localfolder } }))
      .toEqual({ ok: true, detail: '目录可写：D:\\md' });
  });

  /* ===== [V0.11.18] A6：选了「本地 + 云端」但没填全 → 状态区只说一句原因 ===== */

  it('A6：WebDAV 缺地址与账号 → 逐字「云端还没填全，暂时不会同步。」且不叠加「今天还没上传」', async () => {
    api.get.mockResolvedValue(viewWith('webdav', { hasSecret: true }, { baseUrl: '', user: '' }));
    await mount();

    expect(container.textContent).toContain('云端还没填全，暂时不会同步。');
    expect(container.querySelector('[data-missing="true"]')).not.toBeNull();
    expect(container.querySelector('.sync-cloud__status')?.getAttribute('data-ready')).toBe('false');
    /* 「只显示这一句」：两句并排会被读成「在传、只是没传上去」，事实是压根没跑 */
    expect(container.textContent).not.toContain('今天还没上传');
    expect(container.textContent).not.toContain('今天已上传');
    /* 密码项一并不显示（那是填全之后才该说的状态） */
    expect(container.textContent).not.toContain('密码已保存');
  });

  it('A6b：本地目录只看 `localRoot` → 空目录同样报「还没填全」', async () => {
    api.get.mockResolvedValue(viewWith('localfolder', {}, { localRoot: '   ' }));
    await mount();

    expect(container.textContent).toContain('云端还没填全，暂时不会同步。');
    /* 本地目录那条路一次网络请求都不发，地址 / 账号空着不算问题 */
    expect(container.querySelector('[data-missing="true"]')).not.toBeNull();
  });

  it('A6c：填全之后那句话消失，回到正常状态行', async () => {
    await mount();
    expect(container.textContent).not.toContain('云端还没填全，暂时不会同步。');
    expect(container.querySelector('.sync-cloud__status')?.getAttribute('data-ready')).toBe('true');
    expect(container.textContent).toContain('今天还没上传');
  });
});
