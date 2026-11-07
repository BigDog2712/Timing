import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncCloud, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { REMOVED_PHRASES } from './mdSyncCopy';

/* [V0.11.18] T1「存储通道二选一」的**界面层**判据（PRD A1–A6 / 设计 §2.10 A1a–A1i）。
   与 `mdSyncConfig.test.ts` 分工：那边证明三个纯函数对，这边证明界面上真的用上了它们。

   为什么单独一个文件：`mdSyncA1.test.tsx` 是 v0.11.16 的「五块说明行数」判据，改动理由
   不同；`MdSyncTab.test.tsx` 是壳。混进去会让「这一条红了到底是谁的责任」说不清。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 待办事项' },
];

const CLOUD: MdSyncCloud = {
  enabled: true,
  mode: 'localfolder',
  localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD',
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: 'me@example.com',
};

/** 主人真实配置的形状：配过云端、通道开着、载体是本地目录 */
function view(cloud: MdSyncCloud | null): MdSyncViewCloud {
  return {
    today: '2026-11-18',
    config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud },
    cloud: {
      enabled: cloud?.enabled ?? false,
      mode: cloud?.mode ?? 'webdav',
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
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

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

const group = () => container.querySelector('[role="group"][aria-label="存储通道"]');
const cloudInputs = () => Array.from(container.querySelectorAll('[data-block="data-cloud"] input')) as HTMLInputElement[];

/** 全页可见文本 + 每处 `title` / `aria-label`（PRD F6 要求这三处都搜） */
function allText(): string {
  const parts = [container.textContent ?? ''];
  for (const el of Array.from(container.querySelectorAll('[title]'))) parts.push(el.getAttribute('title') ?? '');
  for (const el of Array.from(container.querySelectorAll('[aria-label]'))) parts.push(el.getAttribute('aria-label') ?? '');
  return parts.join('\n');
}

describe('存储通道二选一（T1 / PRD A1–A6）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(view(CLOUD));
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(CLOUD), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('A1a：页签顶部有 role=group + aria-label=存储通道，两项逐字「只用本地」/「本地 + 云端」', async () => {
    await mount();
    const seg = group();
    expect(seg).not.toBeNull();
    expect(Array.from(seg?.querySelectorAll('button') ?? []).map((el) => el.textContent))
      .toEqual(['只用本地', '本地 + 云端']);
    /* 位置判据：**不在 `.data__head` 里**。它在页签层、且就在 header 的下一个兄弟上——
       `mdSyncA1.test.tsx` 用 `toBe` 钉死了 `.data__head` 的 textContent 逐字等于「数据管理」。 */
    expect(container.querySelector('.data__head')?.contains(seg as Node)).toBe(false);
    expect(seg?.parentElement?.className).toBe('sync__channel');
  });

  it('A1b：页签内 Switch 总数 2 → 1（只剩块③的「启用 Markdown 同步」）', async () => {
    await mount();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches).toHaveLength(1);
    /* `Switch.tsx` 用的是 `role="switch"` 而不是 `checkbox`：查 checkbox 会得到 0 个、假绿 */
    expect(switches[0].getAttribute('aria-label')).toBe('启用 Markdown 同步');
  });

  it('A1g：从没配过云端（cloud === null）→ 默认选中「只用本地」', async () => {
    api.get.mockResolvedValue(view(null));
    await mount();
    const on = Array.from(group()?.querySelectorAll('button') ?? [])
      .filter((el) => el.getAttribute('data-on') === 'true').map((el) => el.textContent);
    expect(on).toEqual(['只用本地']);
  });

  it('A1i：真实配置（enabled:true + localfolder）读出来 → 选中「本地 + 云端」，且**没写过盘**', async () => {
    await mount();
    const on = Array.from(group()?.querySelectorAll('button') ?? [])
      .filter((el) => el.getAttribute('data-on') === 'true').map((el) => el.textContent);
    expect(on).toEqual(['本地 + 云端']);
    /* 「读的时候不许改盘」：打开页签只允许 md_sync_get 一次 */
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('A1d + A1e：切到只用本地 → 块④ 输入框 disabled 但**仍在 DOM**，「测试连接」仍可点', async () => {
    await mount();
    expect(cloudInputs().some((el) => el.disabled)).toBe(false);
    await click('只用本地');

    const inputs = cloudInputs();
    expect(inputs.length).toBeGreaterThan(0);
    /* 变灰、不隐藏（PRD A5）：不是 `display:none`、不是从树上摘掉 */
    for (const el of inputs) {
      expect(el.disabled).toBe(true);
      expect(el.isConnected).toBe(true);
    }
    /* 只读探测是合理诉求：这一条故意不跟 `disabled`，别顺手灰掉 */
    expect(button('测试连接').disabled).toBe(false);
    /* 两个载体分段也仍可点（那是预填，不是生效） */
    expect(button('WebDAV').disabled).toBe(false);
  });

  it('A1f：配过云端的人切到只用本地 → 出现「云端配置已保留，切回即恢复。」', async () => {
    await mount();
    expect(container.querySelector('[data-retained="true"]')).toBeNull();
    await click('只用本地');
    const retained = container.querySelector('[data-retained="true"]');
    expect(retained?.textContent).toBe('云端配置已保留，切回即恢复。');
    /* 它是 CH4 那一句，不许冒充页签层的 `data__hint` / `data__note` */
    expect(retained?.className).toBe('sync-cloud__hint');
  });

  it('A1f：从没配过的人切到只用本地 → 不出现那句（他找不着那份「已保留」的配置）', async () => {
    api.get.mockResolvedValue(view(null));
    await mount();
    expect(group()?.querySelector('button[data-on="true"]')?.textContent).toBe('只用本地');
    expect(container.querySelector('[data-retained="true"]')).toBeNull();
  });

  it('A1h：从没配过的人点「本地 + 云端」再点回「只用本地」保存 → 落库 cloud === null', async () => {
    api.get.mockResolvedValue(view(null));
    await mount();
    await click('本地 + 云端');
    await click('只用本地');
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    /* 归一生效：否则这里会是一个 `{enabled:false, mode:'webdav', baseUrl:…}` 的空壳 */
    expect(saved.cloud).toBeNull();
  });

  it('A3：配过云端的人切到只用本地保存 → 地址 / 目录 / 账号一个字节没变，只有 enabled 变', async () => {
    await mount();
    await click('只用本地');
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.cloud).toEqual({ ...CLOUD, enabled: false });
  });

  /* ===== 文案判据（PRD A1c / F1 / F6）===== */

  it('A1c / F1：全页零命中「启用云端通道」与三句已删文案（含 title / aria-label）', async () => {
    await mount();
    const text = allText();
    for (const phrase of REMOVED_PHRASES) expect(text).not.toContain(phrase);
  });

  it('F6：数据管理页签（含折叠体）搜「汇总」0 命中（textContent / title / aria-label）', async () => {
    await mount();
    expect(allText()).not.toContain('汇总');
    /* 逐档展开后再搜一遍：展开态的文案也在判据范围内 */
    const tiers = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '逐个设置');
    if (tiers) await act(async () => { tiers.click(); await Promise.resolve(); });
    expect(allText()).not.toContain('汇总');
  });
});
