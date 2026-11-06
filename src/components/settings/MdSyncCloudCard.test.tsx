import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudMode, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* `IS_MOBILE` 是编译期常量：用可变开关做替身，同一文件里分别测手机端 / 桌面端 */
const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({ mdSyncApi: api, mdBackupApi: { list: vi.fn(), restore: vi.fn() } }));

import { MdSyncCloudCard } from './MdSyncCloudCard';
import { useMdSyncDraft } from './useMdSyncDraft';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function viewWith(mode: CloudMode): MdSyncViewCloud {
  const cloud = { enabled: true, mode, localRoot: 'D:\\Nutstore\\TimingMD',
    baseUrl: 'https://dav.example.com/dav/', basePath: '/Timing/md', user: 'me@example.com' };
  return { today: '2026-11-06',
    config: { enabled: true, pollSecs: 900, cloud,
      bindings: [{ kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' }] },
    cloud: { enabled: true, mode, hasSecret: true, todayPushed: true,
      pendingDates: ['2026-11-04', '2026-11-05'], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] } };
}

/** 真 Hook + 真卡：只有这样才能钉住「没碰密码框 → secret 是 undefined」这条链路 */
function Harness(): ReactElement {
  const draft = useMdSyncDraft();
  return createElement('div', null,
    createElement(MdSyncCloudCard, { draft }),
    createElement('button', { type: 'button', onClick: () => void draft.save() }, '保存'));
}

let container: HTMLDivElement; let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((i) => i.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

async function click(text: string): Promise<void> {
  await act(async () => { button(text).click(); await Promise.resolve(); });
}

async function type(selector: string, value: string): Promise<void> {
  const input = container.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const result = () => container.querySelector('.sync-cloud__result');

describe('MdSyncCloudCard', () => {
  beforeEach(() => {
    host.mobile = false;
    for (const fn of [api.get, api.save, api.test]) fn.mockReset();
    api.get.mockResolvedValue(viewWith('webdav'));
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({
      ...viewWith(config.cloud?.mode ?? 'webdav'), config,
    }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('切换模式后字段跟着换：WebDAV 五个字段 / 本地目录只看路径', async () => {
    await mount();
    expect(container.textContent).toContain('服务地址');
    expect(container.querySelector('input[placeholder="https://dav.jianguoyun.com/dav/"]')).not.toBeNull();
    await click('本地目录');
    expect(container.textContent).toContain('换机器时把它同步过去即可');
    expect(container.textContent).not.toContain('应用密码');
    await click('WebDAV');
    expect(container.textContent).toContain('服务地址');
  });

  it('没碰过密码框时保存透传 undefined（不是空串，否则会清掉已存密码）', async () => {
    await mount();
    const field = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(field.value).toBe('');
    /* hasSecret 只影响 placeholder，绝不能被反填成明文或 **** */
    expect(field.placeholder).toBe('已保存，留空表示不修改');
    await click('保存');
    const [config, secret] = api.save.mock.calls[0];
    expect(secret).toBeUndefined();
    expect(config.cloud.mode).toBe('webdav');
  });

  it('输入密码后透传明文，「清除密码」后透传空串', async () => {
    await mount();
    await type('input[type="password"]', 'app-pass-123');
    await click('保存');
    expect(api.save.mock.calls[0][1]).toBe('app-pass-123');
    await click('清除密码');
    await click('保存');
    expect(api.save.mock.calls[1][1]).toBe('');
  });

  it('测试连接按 ok 值分别给绿字与红字，失败原文照给', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '连接正常' });
    await mount();
    await click('测试连接');
    expect(result()?.textContent).toBe('连接正常');
    expect(result()?.getAttribute('data-ok')).toBe('true');
    api.test.mockResolvedValueOnce({ ok: false, detail: '账号或应用密码不对' });
    await click('测试连接');
    expect(result()?.textContent).toBe('账号或应用密码不对');
    expect(result()?.getAttribute('data-ok')).toBe('false');
  });

  it('手机端不出现「本地目录」，且不会偷偷把 mode 改掉', async () => {
    host.mobile = true;
    api.get.mockResolvedValue(viewWith('localfolder'));
    await mount();
    const modes = Array.from(container.querySelectorAll('.seg__item')).map((item) => item.textContent);
    expect(modes).toEqual(['WebDAV']);
    /* 内存里还是 localfolder → 按 WebDAV 渲染，但保存原样带回，不静默改用户配置 */
    expect(container.textContent).toContain('服务地址');
    await click('保存');
    expect(api.save.mock.calls[0][0].cloud.mode).toBe('localfolder');
  });
});
