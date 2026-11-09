/**
 * QA 独立验收 · V0.11.18 批 0（一）：**老用户的配置一个字节都不许丢**
 * （PRD A3 / A4 / C2 → V0.11.26 的 O11–O13 / O16 / O20 平移）
 * -----------------------------------------------------------------------------
 * 这个文件是 QA 写的，不复用工程师的断言口径，理由有三条：
 *
 * 1. **口径来源不同**：`LIVE_CLOUD` 是从主人**活库**逐字抄下来的那一段（中文路径、邮箱、
 *    `%USERPROFILE%` 三坑齐全），不是「合理构造的夹具」。
 * 2. **`toEqual` 挡不住「字段被换掉又换回来」**：所以两通路都做 `JSON.stringify(...)` 的
 *    **全串**比对（键序 / 少一个键 / 多一个键都会红）。
 * 3. 三类用户各验一遍：配过云端的、从没配过云端的（两通路都是 `null`）、以及
 *    「读的时候不许改盘」。
 *
 * [V0.11.26] 老库是 **legacy `cloud`（带 `mode`）**，桌面后端在 `load()` 里读时推断成
 * 两条通路（`split_legacy`，磁盘零写）：活跃侧承接 `enabled` 与全部字段，非活跃侧
 * `enabled=false` 但**字段留原值**——所以下面 `inferred()` 给的是**后端已经折算过的视图**。
 * 判据从「整份 JSON 逐字节不变」变成「两条通路逐字节不变 + legacy `cloud` 键不被复用」。
 *
 * 「红字 / 文案」那两批判据在 `mdSyncV0118RedAndCopy.test.tsx`：
 * `check:size` 是 300 行硬门禁且**零豁免**，一个文件塞不下。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloudChannel, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* ---------------------------------------------------------------------------
   主人活库里 legacy `cloud` 那一段（`mode: 'localfolder'`）。任何字段的改动都是
   「用户的配置丢了」。
--------------------------------------------------------------------------- */
const LIVE_CLOUD = {
  enabled: true,
  mode: 'localfolder' as const,
  localRoot: 'C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing',
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: '498019678@qq.com',
};

const LIVE_BINDINGS = [
  {
    kind: 'timers' as const, enabled: true,
    root: '%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary',
    file: '{date}.md', heading: '#### 事项计时',
  },
  {
    kind: 'notes' as const, enabled: true,
    root: '%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary',
    file: '{date}.md', heading: '#### 便利贴',
  },
  {
    kind: 'todos' as const, enabled: true, root: '%APP_DIR%\\md',
    file: '{date}.md', heading: '#### 待办事项',
  },
];

type LiveConfig = MdSyncViewCloud['config'];

/** 每条通路都带**全部四个字段**（`split_legacy` 就是「全字段原值 + 一侧 enabled」）。 */
function channelOf(enabled: boolean): MdSyncCloudChannel {
  return {
    enabled,
    localRoot: LIVE_CLOUD.localRoot,
    baseUrl: LIVE_CLOUD.baseUrl,
    basePath: LIVE_CLOUD.basePath,
    user: LIVE_CLOUD.user,
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

/** 后端 `load()` 的输出：legacy `cloud` 不再出现，两条通路各一份（活跃侧 folder）。 */
function liveConfig(): LiveConfig {
  return {
    enabled: true,
    pollSecs: 900,
    bindings: LIVE_BINDINGS.map((binding) => ({ ...binding })),
    cloud: null,
    cloudFolder: channelOf(true),
    cloudWebdav: channelOf(false),
  };
}

function viewWith(patch: Partial<LiveConfig> = {}): MdSyncViewCloud {
  const config = { ...liveConfig(), ...patch };
  return {
    today: '2026-11-07',
    config,
    cloud: {
      enabled: config.cloudWebdav?.enabled ?? false,
      mode: 'webdav',
      hasSecret: false,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
    },
    local: {
      enabled: config.cloudFolder?.enabled ?? false,
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

/** 点一次「保存并同步」，返回**这一次**发出去的那份配置 */
async function save(): Promise<LiveConfig> {
  const before = api.save.mock.calls.length;
  await act(async () => {
    const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '保存并同步');
    (found as HTMLButtonElement).click();
    await Promise.resolve();
  });
  expect(api.save.mock.calls.length).toBe(before + 1);
  return api.save.mock.calls[before][0] as LiveConfig;
}

/** 拨某个块标题右侧的开关（`label` 逐字：`启用本地同步` / `启用云端同步`） */
async function flip(label: string): Promise<void> {
  const toggle = container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  await act(async () => { toggle.click(); await Promise.resolve(); });
}

/** 两条通路逐字节比对（`split_legacy` 的全字段形状） */
function expectChannelsIdentical(config: LiveConfig): void {
  expect(JSON.stringify(config.cloudFolder)).toBe(JSON.stringify(channelOf(true)));
  expect(JSON.stringify(config.cloudWebdav)).toBe(JSON.stringify(channelOf(false)));
}

describe('QA · 老用户配置零丢失（O11 / O12 / O13 / O16 / O20）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(viewWith());
    api.save.mockImplementation(async (config: LiveConfig) => ({ ...viewWith(), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('读的时候不许改盘：打开设置只 md_sync_get 一次，md_sync_save / md_sync_run 零次', async () => {
    await mount();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
    expect(api.run).not.toHaveBeenCalled();
  });

  it('O20：打开设置 → 什么都不改 → 保存：两条通路逐字节不变，legacy `cloud` 键不被复用', async () => {
    await mount();
    const saved = await save();
    expectChannelsIdentical(saved);
    /* O11：新保存形里 `cloud` 恒 `null`（后端 `Option` 收到 null 就是 None，落库不出现） */
    expect(saved.cloud).toBeNull();
    /* 定位断言：万一上面那条红了，这几行直接指出是谁动了 */
    expect(saved.pollSecs).toBe(900);
    expect(saved.bindings.map((b) => b.root)).toEqual(LIVE_BINDINGS.map((b) => b.root));
    /* 老库没有 `auto` 键 → 一次没动控件的保存不许凭空长出来（键序也钉住）
       [V0.11.33] 字段只增不改：+`diaryTemplate`（未配置 = 空串，后端 skip 不落盘，P19 记账） */
    expect(Object.keys(saved)).toEqual([
      'enabled', 'pollSecs', 'bindings', 'cloud', 'cloudFolder', 'cloudWebdav', 'diaryTemplate',
    ]);
    expect(saved.cloudFolder).not.toHaveProperty('auto');
    expect(saved.cloudWebdav).not.toHaveProperty('auto');
  });

  it('A3 平移：关掉块④ 的开关 → 保存：localRoot / 三件套一个字节没变，只有 enabled 变', async () => {
    await mount();
    await flip('启用本地同步');
    const saved = await save();

    expect(saved.cloudFolder?.enabled).toBe(false);
    const after = saved.cloudFolder as MdSyncCloudChannel;
    for (const key of ['localRoot', 'baseUrl', 'basePath', 'user'] as const) {
      expect(after[key]).toBe(LIVE_CLOUD[key]);
    }
    /* `enabled` 是唯一允许变的字节：其余整串仍与推断值逐字相同 */
    expect(JSON.stringify({ ...after, enabled: true })).toBe(JSON.stringify(channelOf(true)));
    /* 另一条通路一个字节都没动 */
    expect(JSON.stringify(saved.cloudWebdav)).toBe(JSON.stringify(channelOf(false)));
    expect(saved.pollSecs).toBe(900);
  });

  it('A4 / O16：关 → 保存 → 再开 → 保存：配置自动恢复、无需重填', async () => {
    await mount();
    await flip('启用本地同步');
    await save();

    /* 后端已落库 `enabled: false`，第二次保存以它为准（`folderConfigured` 仍为 true） */
    const off = { ...channelOf(true), enabled: false };
    await act(async () => {
      api.get.mockResolvedValue(viewWith({ cloudFolder: off }));
      useMdSyncStore.setState({ view: viewWith({ cloudFolder: off }) });
      await Promise.resolve();
    });

    await flip('启用本地同步');
    const saved = await save();
    expect(saved.cloudFolder?.enabled).toBe(true);
    expectChannelsIdentical({ ...saved, cloudFolder: channelOf(true) });
    /* A4 的界面判据：再开之后落点目录框立即可用（不用重填） */
    const inputs = Array.from(
      container.querySelectorAll('[data-block="data-local"] input'),
    ) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((el) => el.disabled)).toBe(false);
  });

  it('O13：从没配过（两条通路都是 null）→ 直接保存 → 仍落 null，不长出空壳', async () => {
    api.get.mockResolvedValue(viewWith({ cloudFolder: null, cloudWebdav: null }));
    await mount();
    const saved = await save();

    expect(saved.cloudFolder).toBeNull();
    expect(saved.cloudWebdav).toBeNull();
    /* 空壳的具体形状（这条不是「大概对」，是主人点名不许出现的那一坨） */
    expect(JSON.stringify(saved)).not.toContain('dav.jianguoyun.com');
  });

  it('C2：老用户 pollSecs 无入口可改，来回拨两个开关后保存仍是 900', async () => {
    await mount();
    await flip('启用本地同步');
    await flip('启用云端同步');
    const saved = await save();
    expect(saved.pollSecs).toBe(900);
    expect(saved.pollSecs).not.toBe(15);
  });
});
