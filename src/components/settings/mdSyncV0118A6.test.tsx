/**
 * QA 复验 · V0.11.18 A6（DOM 半场）：`云端还没填全，暂时不会同步。` 的出现条件与**独占性**
 * （PRD §14.4 的 A6a / A6b / A6c / A6d）。
 * -----------------------------------------------------------------------------
 * 这一批判据的核心不是「那句话出来了没有」，而是**它是不是一个人站在那里**：
 * §14.4 的「显示规矩（硬）」要求它出现时状态区**只**显示这一句 —— 不渲染
 * `密码已/未设置`、不渲染 `今天已/还没上传`、不渲染 `待补传 N 天`，也不叠加历史 `lastError`。
 *
 * 为什么必须卡这么死：`今天还没上传` 与 `暂时不会同步` 并排，读者会读成「在传、只是还没
 * 传上去」，而事实是**压根没跑**（`md_cloud::usable_*` 返回 `None`，那一轮一条路都没动）。
 * 同一件事用两个互相抵消的句子说，比一句不说更糟。
 *
 * [V0.11.26] 判据从「一份带 mode 的 cloud」平移到**两条通路各判一次**（PRD O14）：
 * 块⑤ 说 `云端还没填全，暂时不会同步。`、块④ 说 `云端目录还没填，暂时不会同步。`（L4）。
 * 两块各读各的状态（`view.cloud` / `view.local`），所以「哪一句出现在哪一块」本身也是判据。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloudChannel, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { LOCAL_MISSING_NOTE } from './MdSyncLocalCard';
import { WEBDAV_MISSING_NOTE } from './MdSyncWebdavCard';

const CL1 = '云端还没填全，暂时不会同步。';
/** [V0.11.26] CH4「云端配置已保留，切回即恢复。」整句退役（`REMOVED_PHRASES` 里钉着） */
const CH4 = '云端配置已保留，切回即恢复。';

const FILLED: MdSyncCloudChannel = {
  enabled: true,
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: 'me@example.com',
};

const FOLDER: MdSyncCloudChannel = {
  enabled: true,
  localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD',
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

interface Over {
  hasSecret?: boolean;
  lastError?: string | null;
  pendingDates?: string[];
  folder?: MdSyncCloudChannel;
}

function viewWith(webdav: MdSyncCloudChannel, over: Over = {}): MdSyncViewCloud {
  const folder = over.folder ?? FOLDER;
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: [], cloud: null, cloudFolder: folder, cloudWebdav: webdav },
    cloud: {
      enabled: webdav.enabled,
      mode: 'webdav',
      hasSecret: over.hasSecret ?? false,
      todayPushed: false,
      pendingDates: over.pendingDates ?? [],
      lastError: over.lastError ?? null,
    },
    local: {
      enabled: folder.enabled,
      mode: 'localfolder',
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

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

async function mount(view: MdSyncViewCloud): Promise<void> {
  api.get.mockResolvedValue(view);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdSyncTab));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

/** 只在这两块里找：`data-missing` 与状态行两块都有，不限定就会互相冒充 */
const inBlock = (id: string, selector: string) =>
  container.querySelector(`[data-block="${id}"] ${selector}`);
const missing = () => inBlock('data-cloud', '[data-missing="true"]');
const missingLocal = () => inBlock('data-local', '[data-missing="true"]');
const statusBox = () => inBlock('data-cloud', '.sync-cloud__status');
const statusText = () => (statusBox()?.textContent ?? '').trim();

describe('QA · A6 未填全状态行（PRD §14.4 A6a–A6d → O14 两通路各判一次）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
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

  it('A6a（O14 块⑤）：逐个清空 baseUrl / basePath / user，任一为空都出现 CL1（三次各验一次）', async () => {
    const blanks = [
      { field: 'baseUrl', channel: { ...FILLED, baseUrl: '' } },
      { field: 'basePath', channel: { ...FILLED, basePath: '' } },
      { field: 'user', channel: { ...FILLED, user: '' } },
    ] as const;

    for (const { field, channel } of blanks) {
      await mount(viewWith(channel));
      expect(missing(), `清空 ${field} 之后必须出现 CL1`).not.toBeNull();
      expect(missing()?.textContent, `${field} 档的文案`).toBe(CL1);
      expect(CL1).toBe(WEBDAV_MISSING_NOTE);
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });

  it('A6a 反向：三项填全 → CL1 不出现', async () => {
    await mount(viewWith(FILLED));
    expect(missing()).toBeNull();
  });

  it('A6a 补充（O14 块④）：清空落点目录 → 出现 L4 那句，且块⑤ 不受影响', async () => {
    await mount(viewWith(FILLED, { folder: { ...FOLDER, localRoot: '' } }));
    expect(missingLocal()?.textContent).toBe(LOCAL_MISSING_NOTE);
    expect(LOCAL_MISSING_NOTE).toBe('云端目录还没填，暂时不会同步。');
    /* 两条通路各判各的：块④ 没填全不该让块⑤ 也说自己没填全 */
    expect(missing()).toBeNull();
  });

  it('A6c：CL1 出现时状态区**只有这一句** —— 今天还没上传 / 待补传 / 密码未 各 0 命中', async () => {
    await mount(viewWith({ ...FILLED, user: '' }, { hasSecret: false, pendingDates: ['2026-11-01', '2026-11-02'] }));

    expect(statusBox()).not.toBeNull();
    expect(statusText()).toBe(CL1);
    for (const phrase of ['今天还没上传', '今天已上传', '待补传', '密码未', '密码已']) {
      expect(statusText(), `状态区里不该出现「${phrase}」`).not.toContain(phrase);
    }
  });

  it('A6c 补充：CL1 出现时不叠加历史 lastError（上一份配置的结论只进日志）', async () => {
    await mount(viewWith({ ...FILLED, user: '' }, { lastError: '还没保存应用密码' }));
    expect(statusText()).toBe(CL1);
    /* 页面上任何位置的 `.sync__error` 都不该出现（它只属于「保存失败」与「测试连接失败」） */
    expect(container.querySelector('.sync__error')).toBeNull();
    expect(container.textContent).not.toContain('还没保存应用密码');
  });

  it('A6b：三项填全、密码留空 → CL1 不出现，状态行显示「密码未设置」', async () => {
    await mount(viewWith(FILLED, { hasSecret: false }));
    expect(missing()).toBeNull();
    expect(statusText()).toContain('密码未设置');
    expect(statusText()).toContain('今天还没上传');
  });

  it('A6d（O9 平移）：关掉块⑤ 的开关 → CL1 消失、状态区整块收起，CH4 已经不存在', async () => {
    await mount(viewWith({ ...FILLED, user: '' }));
    expect(missing()).not.toBeNull();

    const toggle = container.querySelector('[aria-label="启用云端同步"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); await Promise.resolve(); });

    expect(missing(), '用户主动关掉通路 ≠ 没填全，不该再说「还没填全」').toBeNull();
    /* CH4「云端配置已保留，切回即恢复。」整句退役：关掉只是不跑，不再另说一句 */
    expect(container.textContent).not.toContain(CH4);
    expect(container.querySelector('[data-retained="true"]')).toBeNull();
    /* 状态区整块收起（`channel.enabled && status` 为假） */
    expect(statusBox()).toBeNull();
    /* 关掉不隐藏：字段还在，用户随时能看自己填过什么（O10） */
    expect(inBlock('data-cloud', 'input[placeholder="坚果云登录邮箱"]')).not.toBeNull();
  });
});
