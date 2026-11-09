/**
 * QA · 文案与「不再暗示汇总」（PRD F1 / F2 / F6 → O2 / O7 / O8）
 * -----------------------------------------------------------------------------
 * 从 `mdSyncV0118RedAndCopy.test.tsx`（300 行上限）拆出的文案半：hint 逐字、
 * 15 条已删文案零命中、「汇总」零命中、通道分段退场、开关记账。
 * 「报红但能同步」那半留在原文件；夹具与那边同款，改一边必须改另一边。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloudChannel, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { COPY, REMOVED_PHRASES } from './mdSyncCopy';

/** 主人活库里云端那一半（legacy `localfolder`，两条通路都从它推断而来） */
const LIVE_FOLDER = 'C:////Users////49801////Nutstore////1////我的坚果云////Timing';

const FOLDER: MdSyncCloudChannel = { enabled: true, localRoot: LIVE_FOLDER };
const WEBDAV: MdSyncCloudChannel = {
  enabled: true,
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: '498019678@qq.com',
};

const DATA_ROOT: DataRootInfo = {
  current: 'D:////Timing////data',
  defaultPath: 'C:////Program Files\\Timing\\data',
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

function viewWith(over: { folder?: MdSyncCloudChannel | null; webdav?: MdSyncCloudChannel | null } = {}): MdSyncViewCloud {
  const folder = over.folder === undefined ? FOLDER : over.folder;
  const webdav = over.webdav === undefined ? WEBDAV : over.webdav;
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: [], cloud: null, cloudFolder: folder, cloudWebdav: webdav },
    cloud: {
      enabled: webdav?.enabled ?? false,
      mode: 'webdav',
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
    local: {
      enabled: folder?.enabled ?? false,
      mode: 'localfolder',
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), test: vi.fn() }));
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

/** 全页可见文本 + 每处 `title` / `aria-label`（F6 要求这三处都搜） */
function allText(): string {
  const parts = [container.textContent ?? ''];
  for (const el of Array.from(container.querySelectorAll('[title]'))) parts.push(el.getAttribute('title') ?? '');
  for (const el of Array.from(container.querySelectorAll('[aria-label]'))) parts.push(el.getAttribute('aria-label') ?? '');
  return parts.join('\n');
}

describe('QA · 文案与「不再暗示汇总」（PRD F1 / F2 / F6 → O2 / O7 / O8）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(viewWith());
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('F2：三句 hint 逐字等于 PRD 锁定用稿（块④ 新增 L2）', async () => {
    await mount();
    expect(COPY.syncHint).toBe('日记本：双向，保留你手写的内容。');
    expect(COPY.localHint).toBe('同步目录：交给网盘客户端多端一致。');
    expect(COPY.cloudHint).toBe('多端一致用：体积小，读得快。');
    const text = allText();
    expect(text).toContain('日记本：双向，保留你手写的内容。');
    expect(text).toContain('同步目录：交给网盘客户端多端一致。');
    expect(text).toContain('多端一致用：体积小，读得快。');
  });

  it('F1 + REMOVED_PHRASES：十五条已删文案全页零命中（textContent / title / aria-label）', async () => {
    await mount();
    expect(REMOVED_PHRASES).toHaveLength(15);
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

  it('O2：页签顶部没有存储通道分段，`h3 数据管理` 之后直接是六块', async () => {
    await mount();
    /* 变更一整组删除：`[role="group"][aria-label="存储通道"]` 一个都不该有 */
    expect(container.querySelector('[role="group"][aria-label="存储通道"]')).toBeNull();
    expect(container.querySelector('[role="group"][aria-label="云端通道方式"]')).toBeNull();
    /* `.data__head` 的下一个元素就是第一块（中间不夹任何「选边」控件） */
    const head = container.querySelector('.data__head') as HTMLElement;
    expect(head.nextElementSibling?.getAttribute('data-block')).toBe('data-format');
    const blocks = Array.from(container.querySelectorAll('.data > [data-block]'))
      .map((el) => el.getAttribute('data-block'));
    expect(blocks).toEqual(['data-format', 'data-root', 'data-sync', 'data-local', 'data-cloud', 'data-backup']);
  });

  it('O8：全页恰好 3 个 `role="switch"`，标签逐字（总开关 + 两条通路各一个）', async () => {
    await mount();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches).toHaveLength(3);
    expect(switches.map((el) => el.getAttribute('aria-label'))).toEqual([
      '启用 Markdown 同步', '启用本地同步', '启用云端同步',
    ]);
    /* 每块标题右侧各一个：块里不许再长第四个 */
    expect(container.querySelector('[data-block="data-sync"] [role="switch"]')).not.toBeNull();
    expect(container.querySelector('[data-block="data-local"] [role="switch"]')).not.toBeNull();
    expect(container.querySelector('[data-block="data-cloud"] [role="switch"]')).not.toBeNull();
    expect(container.querySelector('[data-block="data-format"] [role="switch"]')).toBeNull();
  });
});
