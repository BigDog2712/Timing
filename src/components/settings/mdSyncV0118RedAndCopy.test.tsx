/**
 * QA 独立验收 · V0.11.18 批 0（二）：「报红但能同步」真的修好了吗（PRD A7 / A8）
 * + 文案与「不再暗示汇总」（PRD F1 / F2 / F6）
 * -----------------------------------------------------------------------------
 * 与 `mdSyncV0118Fidelity.test.tsx` 的分工：那边验「配置一个字节都不许丢」，这边验
 * 「界面上的红字与那几句话」。两个文件分开是因为 `check:size` 是 300 行硬门禁（零豁免），
 * 一个文件装不下两批判据。
 *
 * ## 为什么红字的断言必须查**两个** DOM 来源
 *
 * 主人当时看到的是「界面上有一行红字，但同步其实在正常工作」。块④ 里能变红的 DOM 有两处：
 * 1. `.sync-cloud__result` 里失败那一关的原文（「测试连接」的结论）；
 * 2. `.sync-cloud__status` 里的 `.sync__error`（`lastError`）。
 * 工程师的 A8 只钉了第 1 处。只有一处的红字清掉、另一处还在，主人看到的画面是一样的，
 * 所以这里两处都查，并且按主人真实的**操作顺序**走：
 * WebDAV → 点「测试连接」→ 拿到 403 红字 → **切回**「本地目录」→ 红字必须立刻消失。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloud, MdSyncTestResult, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { COPY, REMOVED_PHRASES } from './mdSyncCopy';

/** 主人活库里云端那一段（`mode` 会被逐用例改写成本地目录 / WebDAV 两种） */
const LIVE_CLOUD: MdSyncCloud = {
  enabled: true,
  mode: 'localfolder',
  localRoot: 'C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing',
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: '498019678@qq.com',
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

function viewWith(cloud: MdSyncCloud): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: [], cloud },
    cloud: {
      enabled: cloud.enabled,
      mode: cloud.mode,
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

/** 坚果云 403 的形状：红在第 1 关（账号），只带走过的关 */
const FORBIDDEN: MdSyncTestResult = {
  ok: false,
  detail: '账号或应用密码不对',
  steps: [{ key: 'account', ok: false, detail: '账号或应用密码不对' }],
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

/** 全页可见文本 + 每处 `title` / `aria-label`（F6 要求这三处都搜） */
function allText(): string {
  const parts = [container.textContent ?? ''];
  for (const el of Array.from(container.querySelectorAll('[title]'))) parts.push(el.getAttribute('title') ?? '');
  for (const el of Array.from(container.querySelectorAll('[aria-label]'))) parts.push(el.getAttribute('aria-label') ?? '');
  return parts.join('\n');
}

/**
 * 界面上「有没有红字」的两个来源一起看：
 * 1. 状态行里的 `lastError`（`.sync-cloud__status .sync__error`）；
 * 2. 「测试连接」失败那一关的原文（`.sync-cloud__result[data-ok=false]`，它内部那一句
 *    也带 `.sync__error` 类，所以必须**限定父容器**再取，否则两个来源会串成一串）。
 */
function redText(): string | null {
  const parts: string[] = [];
  const statusErr = container.querySelector('.sync-cloud__status .sync__error')?.textContent?.trim();
  if (statusErr) parts.push(statusErr);
  const result = container.querySelector('.sync-cloud__result');
  if (result?.getAttribute('data-ok') === 'false') parts.push((result.textContent ?? '').trim());
  return parts.length > 0 ? parts.join(' | ') : null;
}

describe('QA · 「报红但能同步」（PRD A7 / A8 / §13.4）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(viewWith({ ...LIVE_CLOUD, mode: 'webdav' }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('主人真实路径：WebDAV 点出 403 红字 → 切回本地目录 → 红字**立刻**消失', async () => {
    api.test.mockResolvedValueOnce(FORBIDDEN);
    await mount();

    /* 前提：红字确实出来了（否则下面那句「消失」是假绿） */
    await click('测试连接');
    expect(redText()).toContain('账号或应用密码不对');
    expect(container.querySelector('.sync-cloud__result')?.getAttribute('data-ok')).toBe('false');

    await click('本地目录');

    /* 判据 1：界面上**零红字**（`.sync__error` 与失败结果两处都空） */
    expect(redText()).toBeNull();
    expect(container.querySelector('.sync__error')).toBeNull();
    /* 判据 2：`testResult` 渲染为空（整个结果区都不在，不是「空字符串」） */
    expect(container.querySelector('.sync-cloud__result')).toBeNull();
    /* 判据 3：切到本地目录本身**不发**任何探测请求（零网络的界面侧证据） */
    expect(api.test).toHaveBeenCalledTimes(1);
  });

  it('A8：A（WebDAV 红）→ B（本地目录清）→ 再回 A：上一次的红字**不许**复活', async () => {
    api.test.mockResolvedValue(FORBIDDEN);
    await mount();
    await click('测试连接');
    expect(redText()).not.toBeNull();

    await click('本地目录');
    expect(redText()).toBeNull();

    await click('WebDAV');
    expect(redText()).toBeNull();
    /* 回 A 之后按钮还是可点的（没有卡在「测试中…」） */
    expect(button('测试连接').disabled).toBe(false);
  });

  it('A7：本地目录下「测试连接」存在且可点，结果是唯一一句「目录可写：绝对路径」', async () => {
    const root = 'C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing';
    api.get.mockResolvedValue(viewWith({ ...LIVE_CLOUD, mode: 'localfolder' }));
    api.test.mockResolvedValueOnce({ ok: true, detail: `目录可写：${root}` });
    await mount();

    const test = button('测试连接');
    expect(test.disabled).toBe(false);
    await click('测试连接');

    /* 发下去的 `cloud` 必须带 localfolder + localRoot：后端靠它分派，不带就会去测 WebDAV */
    const sent = api.test.mock.calls[0][0] as { cloud: MdSyncCloud | null };
    expect(sent.cloud?.mode).toBe('localfolder');
    expect(sent.cloud?.localRoot).toBe(root);

    const result = container.querySelector('.sync-cloud__result');
    expect(result?.textContent).toBe(`目录可写：${root}`);
    expect(result?.getAttribute('data-ok')).toBe('true');
    /* localfolder 的 probe 只回一句，不渲染三关 */
    expect(result?.querySelector('.sync-cloud__steps')).toBeNull();
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('A7 反向：本地目录下**零红字**（`hasSecret:false` 不再产出「密码未设置」这类红字来源）', async () => {
    api.get.mockResolvedValue(viewWith({ ...LIVE_CLOUD, mode: 'localfolder' }));
    await mount();
    expect(redText()).toBeNull();
    expect(container.textContent).not.toContain('密码未设置');
    expect(container.querySelector('.sync-cloud__status')?.getAttribute('data-mode')).toBe('localfolder');
  });
});

describe('QA · 文案与「不再暗示汇总」（PRD F1 / F2 / F6）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(viewWith({ ...LIVE_CLOUD }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('F2：两句 hint 逐字等于 PRD §13.7 的锁定用稿', async () => {
    await mount();
    expect(COPY.syncHint).toBe('日记本：双向，保留你手写的内容。');
    expect(COPY.cloudHint).toBe('多端一致用：体积小，读得快。');
    const text = allText();
    expect(text).toContain('日记本：双向，保留你手写的内容。');
    expect(text).toContain('多端一致用：体积小，读得快。');
  });

  it('F1 + REMOVED_PHRASES：八条已删文案全页零命中（textContent / title / aria-label）', async () => {
    await mount();
    expect(REMOVED_PHRASES).toHaveLength(8);
    const text = allText();
    for (const phrase of REMOVED_PHRASES) expect(text).not.toContain(phrase);
    /* §4.3 删除项里本批要零命中的三条 */
    for (const phrase of ['多久写一次', '再送一份到坚果云', '启用云端通道']) {
      expect(text).not.toContain(phrase);
    }
  });

  it('F6：「汇总」在折叠态与逐档展开态都零命中', async () => {
    await mount();
    expect(allText()).not.toContain('汇总');
    const tiers = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '逐个设置');
    if (tiers) await act(async () => { tiers.click(); await Promise.resolve(); });
    expect(allText()).not.toContain('汇总');
  });

  it('A1：通道分段在 `h3 数据管理` 正下方、不在 `.data__head` 里，两项逐字', async () => {
    await mount();
    const group = container.querySelector('[role="group"][aria-label="存储通道"]');
    expect(group).not.toBeNull();
    expect(Array.from(group?.querySelectorAll('button') ?? []).map((el) => el.textContent))
      .toEqual(['只用本地', '本地 + 云端']);
    expect(container.querySelector('.data__head')?.contains(group as Node)).toBe(false);
  });

  it('A2：默认态全页 `role="switch"` 恰好 1 个（只有「启用 Markdown 同步」），块④ 内 0 个', async () => {
    await mount();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches).toHaveLength(1);
    expect(switches[0].getAttribute('aria-label')).toBe('启用 Markdown 同步');
    expect(container.querySelector('[data-block="data-cloud"] [role="switch"]')).toBeNull();
  });
});
