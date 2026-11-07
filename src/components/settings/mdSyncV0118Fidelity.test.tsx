/**
 * QA 独立验收 · V0.11.18 批 0（一）：**老用户的云端配置一个字节都不许丢**
 * （PRD A3 / A4 / C2）
 * -----------------------------------------------------------------------------
 * 这个文件是 QA 写的，不复用工程师的断言口径，理由有三条：
 *
 * 1. **口径来源不同**：`LIVE_CONFIG_JSON` 是从主人**活库**（`data/timing.db` 的
 *    `settings.plugin.md-sync.config`）逐字抄下来的字符串，不是「合理构造的夹具」。
 *    判据是「保存后这一串字节不变」，比 `toEqual` 更严：多一个键、少一个键、键序变了
 *    都会红。
 * 2. **`toEqual` 挡不住「字段被换掉又换回来」**：A3 要求的是「一个字节没变」，所以这里做
 *    的是 `JSON.stringify(保存值) === LIVE_CONFIG_JSON` 的**全串**比对，
 *    外加逐字段的定位断言（红了能直接看出是哪个字段动了）。
 * 3. 三档用户各验一遍，因为失败模式完全不同：配过云端的、从没配过云端的（`cloud: null`）、
 *    以及「读的时候不许改盘」。
 *
 * 「红字 / 文案」那两批判据在 `mdSyncV0118RedAndCopy.test.tsx`：
 * `check:size` 是 300 行硬门禁且**零豁免**，一个文件塞不下。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloud, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* ---------------------------------------------------------------------------
   主人活库里的**逐字**配置。任何字段的改动都是「用户的云端配置丢了」。
   `user` 是邮箱、`localRoot` 是中文路径、`root` 里带 `%USERPROFILE%` 与中文目录 ——
   编码 / 反斜杠 / 百分号三个坑的现成样本。
--------------------------------------------------------------------------- */
const LIVE_CONFIG_JSON =
  '{"enabled":true,"pollSecs":900,"bindings":[' +
  '{"kind":"timers","enabled":true,"root":"%USERPROFILE%\\\\OneDrive\\\\应用\\\\remotely-save\\\\Elio\\\\1-MemeX\\\\Diary","file":"{date}.md","heading":"#### 事项计时"},' +
  '{"kind":"notes","enabled":true,"root":"%USERPROFILE%\\\\OneDrive\\\\应用\\\\remotely-save\\\\Elio\\\\1-MemeX\\\\Diary","file":"{date}.md","heading":"#### 便利贴"},' +
  '{"kind":"todos","enabled":true,"root":"%APP_DIR%\\\\md","file":"{date}.md","heading":"#### 待办事项"}' +
  '],"cloud":{"enabled":true,"mode":"localfolder",' +
  '"localRoot":"C:\\\\Users\\\\49801\\\\Nutstore\\\\1\\\\我的坚果云\\\\Timing",' +
  '"baseUrl":"https://dav.jianguoyun.com/dav/","basePath":"/Timing","user":"498019678@qq.com"}}';

type LiveConfig = MdSyncViewCloud['config'];

/** 每次给一份**全新的**对象（避免上一个用例改过的草稿污染下一个） */
function liveConfig(): LiveConfig {
  return JSON.parse(LIVE_CONFIG_JSON) as LiveConfig;
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

function viewWith(cloud: MdSyncCloud | null): MdSyncViewCloud {
  const config = liveConfig();
  config.cloud = cloud;
  return {
    today: '2026-11-07',
    config,
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

/** 点一次「保存并同步」，返回**这一次**发出去的那份配置 */
async function save(): Promise<LiveConfig> {
  const before = api.save.mock.calls.length;
  await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
  expect(api.save.mock.calls.length).toBe(before + 1);
  return api.save.mock.calls[before][0] as LiveConfig;
}

/** 发出去的整份配置 → 与原串逐字节比（键序 / 少一个键 / 多一个键都会红） */
function expectByteIdentical(config: LiveConfig): void {
  expect(JSON.stringify(config)).toBe(LIVE_CONFIG_JSON);
}

describe('QA · 老用户云端配置零丢失（PRD A3 / A4 / C2）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(viewWith(liveConfig().cloud));
    api.save.mockImplementation(async (config: LiveConfig) => ({ ...viewWith(config.cloud), config }));
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

  it('打开设置 → 什么都不改 → 保存：整份配置逐字节不变（A3 的最强形式）', async () => {
    await mount();
    const saved = await save();
    expectByteIdentical(saved);
    /* 定位断言：万一上面那条红了，这几行直接指出是谁动了 */
    expect(saved.pollSecs).toBe(900);
    expect(saved.cloud).toEqual(liveConfig().cloud);
    expect(saved.bindings.map((b) => b.root)).toEqual(liveConfig().bindings.map((b) => b.root));
  });

  it('A3：切到只用本地 → 保存：baseUrl / basePath / localRoot / user / mode 一个字节没变', async () => {
    const before = liveConfig().cloud as MdSyncCloud;
    await mount();
    await click('只用本地');
    const saved = await save();
    const after = saved.cloud as MdSyncCloud;

    expect(after.enabled).toBe(false);
    for (const key of ['baseUrl', 'basePath', 'localRoot', 'user', 'mode'] as const) {
      expect(after[key]).toBe(before[key]);
    }
    /* 通道位之外整份配置仍逐字节相同 —— `enabled` 是唯一允许变的字节 */
    expect(JSON.stringify({ ...saved, cloud: { ...after, enabled: true } })).toBe(LIVE_CONFIG_JSON);
    expect(saved.pollSecs).toBe(900);
  });

  it('A4：只用本地 → 保存 → 切回本地 + 云端 → 保存：配置自动恢复、无需重填', async () => {
    await mount();
    await click('只用本地');
    await save();

    /* 后端已落库 `enabled: false`，第二次保存以它为准（`cloudConfigured` 仍为 true） */
    const off = { ...(liveConfig().cloud as MdSyncCloud), enabled: false };
    api.get.mockResolvedValue(viewWith(off));
    useMdSyncStore.setState({ view: viewWith(off) });

    await click('本地 + 云端');
    const saved = await save();
    expectByteIdentical(saved);
    expect((saved.cloud as MdSyncCloud).enabled).toBe(true);
    /* A4 的界面判据：切回后地址 / 目录 / 账号输入框立即可用（不用重填） */
    const inputs = Array.from(
      container.querySelectorAll('[data-block="data-cloud"] input'),
    ) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((el) => el.disabled)).toBe(false);
  });

  it('从没配过云端（cloud: null）→ 点「本地 + 云端」→ 点回「只用本地」→ 保存：仍落 null', async () => {
    api.get.mockResolvedValue(viewWith(null));
    await mount();
    await click('本地 + 云端');
    await click('只用本地');
    const saved = await save();

    expect(saved.cloud).toBeNull();
    /* 空壳的具体形状（这条不是「大概对」，是主人点名不许出现的那一坨） */
    expect(JSON.stringify(saved.cloud)).not.toContain('dav.jianguoyun.com');
  });

  it('从没配过云端 → 直接保存（一次都没点）→ 仍落 null', async () => {
    api.get.mockResolvedValue(viewWith(null));
    await mount();
    const saved = await save();
    expect(saved.cloud).toBeNull();
  });

  it('C2：老用户 pollSecs 无入口可改，来回切通道后保存仍是 900', async () => {
    await mount();
    await click('只用本地');
    await save();
    await click('本地 + 云端');
    const saved = await save();
    expect(saved.pollSecs).toBe(900);
  });
});
