/**
 * Timing — 块⑤「云端同步」卡的单测（V0.11.13 → V0.11.26）
 * -----------------------------------------------------------------------------
 * 原名 `MdSyncCloudCard.test.tsx`，随组件改名。按 `mode` 选边那批判据整组退场（PRD 变更四）：
 * 本卡只做 WebDAV 一条通路，本地那一半在 `MdSyncLocalCard`（判据在 `mdSyncCloudMode.test.tsx`）。
 * 保留：密码三分、三关逐步点亮（E3/E6/E7）、无 steps 退回、`resolvedBindings` 共用、
 * 默认值预填（E1）、已配置原样（E2）、往期清理四句。
 * [V0.11.26] 新增：关掉开关时字段 disabled 但可见、测试连接仍可点（O9/O10）；
 *   状态行只读 `view.cloud`，不串 `view.local`（O15 数据面）。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdSyncApi: api,
  mdBackupApi: { list: vi.fn(), restore: vi.fn() },
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { MdSyncWebdavCard } from './MdSyncWebdavCard';
import { useMdSyncDraft } from './useMdSyncDraft';
import type { MdSyncDraft } from './useMdSyncDraft';

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

/** 真 Hook + 真卡：只有这样才能钉住「没碰密码框 → secret 是 undefined」这条链路 */
function Harness(): ReactElement {
  const draft = useMdSyncDraft();
  /* 测试要能直接调 `setSharedFile`：这里把草稿抬到一个模块变量上 */
  draftRef = draft;
  return createElement('div', null,
    createElement(MdSyncWebdavCard, { draft }),
    createElement('button', { type: 'button', onClick: () => void draft.save() }, '保存'),
  );
}

let draftRef: MdSyncDraft | null = null;

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

async function click(text: string): Promise<void> {
  await act(async () => { button(text).click(); await Promise.resolve(); });
}

async function type(selector: string, value: string): Promise<void> {
  const input = container.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const result = () => container.querySelector('.sync-cloud__result');

describe('MdSyncWebdavCard（块⑤ 云端同步）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.test]) fn.mockReset();
    api.get.mockResolvedValue(viewWith());
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({
      ...viewWith(), config,
    }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
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
    expect(config.cloudWebdav?.baseUrl).toBe('https://dav.example.com/dav/');
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

  it('E3：三关全绿 → 「账号 ✓ 目录 ✓ 写入 ✓」', async () => {
    api.test.mockResolvedValueOnce({
      ok: true,
      detail: '账号、目录、写入都通过',
      steps: [
        { key: 'account', ok: true, detail: null },
        { key: 'dir', ok: true, detail: null },
        { key: 'write', ok: true, detail: null },
      ],
    });
    await mount();
    await click('测试连接');

    const steps = result()?.querySelector('.sync-cloud__steps');
    expect(steps?.textContent).toBe('账号 ✓ 目录 ✓ 写入 ✓');
    expect(result()?.querySelectorAll('.sync-cloud__step[data-ok="false"]')).toHaveLength(0);
    /* 全绿时不再画任何红字 */
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('E6：红在第 1 关时只显示「账号 ✗」+ 那一句，第 2、3 关不出现', async () => {
    api.test.mockResolvedValueOnce({
      ok: false,
      detail: '账号或应用密码不对（坚果云要用应用密码…）',
      steps: [{ key: 'account', ok: false, detail: '账号或应用密码不对（坚果云要用应用密码…）' }],
    });
    await mount();
    await click('测试连接');

    const steps = result()?.querySelector('.sync-cloud__steps')?.textContent ?? '';
    expect(steps).toBe('账号 ✗');
    expect(steps).not.toContain('目录');
    expect(steps).not.toContain('写入');
    const detail = result()?.querySelector('.sync__error')?.textContent ?? '';
    expect(detail).toContain('账号或应用密码不对');
    /* E7：三行里不出现三位数字状态码 */
    expect(/\d{3}/.test(result()?.textContent ?? '')).toBe(false);
  });

  it('E7：第 3 关的失败文案以红字落在结论行下方，且不带裸状态码', async () => {
    api.test.mockResolvedValueOnce({
      ok: false,
      detail: '文件夹已就绪，但写不进去文件。',
      steps: [
        { key: 'account', ok: true, detail: null },
        { key: 'dir', ok: true, detail: null },
        { key: 'write', ok: false, detail: '文件夹已就绪，但写不进去文件。' },
      ],
    });
    await mount();
    await click('测试连接');

    expect(result()?.querySelector('.sync-cloud__steps')?.textContent).toBe('账号 ✓ 目录 ✓ 写入 ✗');
    expect(result()?.querySelector('.sync__error')?.textContent).toBe('文件夹已就绪，但写不进去文件。');
    expect(/\d{3}/.test(result()?.textContent ?? '')).toBe(false);
  });

  it('后端没给 steps（浏览器 mock / 老后端）→ 退回只显示 detail，不崩', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '连接正常' });
    await mount();
    await click('测试连接');
    expect(result()?.querySelector('.sync-cloud__steps')).toBeNull();
    expect(result()?.textContent).toBe('连接正常');
  });

  it('「测试连接」用的是 resolvedBindings（与保存同一个数组），载荷是 legacy webdav', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '连接正常' });
    await mount();
    /* 在块①那个单框里改一下文件名（统一意图），但**先不保存** */
    await act(async () => { draftRef?.setSharedFile('{date}-asd.md'); await Promise.resolve(); });
    await click('测试连接');
    const config = api.test.mock.calls[0][0];
    expect(config.bindings[0].file).toBe('{date}-asd.md');
    /* `probe.rs` 是红线文件，只认带 `mode` 的旧形状；探测不吃开关（`enabled` 恒 true） */
    expect(config.cloud.mode).toBe('webdav');
    expect(config.cloud.enabled).toBe(true);
    expect(config.cloud.basePath).toBe('/Timing/md');
  });

});
