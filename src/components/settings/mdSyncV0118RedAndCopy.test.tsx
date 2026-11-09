/**
 * QA 独立验收 · 「报红但能同步」（PRD A7 / A8）+ 文案与「不再暗示汇总」（F1 / F2 / F6）
 * -----------------------------------------------------------------------------
 * 主人当时看到的是「界面上有一行红字，但同步其实在正常工作」。块里能变红的 DOM 有两处：
 * ① `.sync-cloud__result` 里失败那一关的原文；② `.sync-cloud__status` 里的 `.sync__error`。
 * 两处都查，否则「一处的红字清掉了、另一处还在」会得到假绿。
 *
 * [V0.11.26] 拆分之后多一层判据：**两条通路的结论不许互相冒充**（O15）。
 * 块⑤ 的 403 红字不能出现在块④，块④ 的「目录可写」也不能出现在块⑤——两块各持一份
 * `testResult` 的直接后果。文案那半随变更一/四扩到 15 条（O2 / O7 / O8）。
 *
 * 「配置一个字节都不许丢」那批在 `mdSyncV0118Fidelity.test.tsx`：`check:size` 是 300 行
 * 硬门禁且零豁免，一个文件塞不下两批判据。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloudChannel, MdSyncTestResult, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/** 主人活库里云端那一半（legacy `localfolder`，两条通路都从它推断而来） */
const LIVE_FOLDER = 'C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing';

const FOLDER: MdSyncCloudChannel = { enabled: true, localRoot: LIVE_FOLDER };
const WEBDAV: MdSyncCloudChannel = {
  enabled: true,
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

/** 按块点按钮：`测试连接` / `关闭` 这些词两块都有，全页 `find` 会点到 DOM 里靠前那个 */
async function clickIn(blockId: string, text: string): Promise<void> {
  const block = container.querySelector(`[data-block="${blockId}"]`) as HTMLElement | null;
  if (!block) throw new Error(`块 ${blockId} 不在 DOM 里`);
  const found = Array.from(block.querySelectorAll('button')).find((el) => el.textContent === text);
  if (!found) throw new Error(`块 ${blockId} 里找不到按钮：${text}`);
  await act(async () => { found.click(); await Promise.resolve(); });
}

/**
 * 某一块里「有没有红字」的两个来源一起看：
 * 1. 状态行里的 `lastError`（`.sync-cloud__status .sync__error`）；
 * 2. 「测试连接」失败那一关的原文（`.sync-cloud__result[data-ok=false]`，它内部那一句
 *    也带 `.sync__error` 类，所以必须**限定父容器**再取，否则两个来源会串成一串）。
 */
function redIn(blockId: string): string | null {
  const scope = container.querySelector(`[data-block="${blockId}"]`);
  if (!scope) return null;
  const parts: string[] = [];
  const statusErr = scope.querySelector('.sync-cloud__status .sync__error')?.textContent?.trim();
  if (statusErr) parts.push(statusErr);
  const result = scope.querySelector('.sync-cloud__result');
  if (result?.getAttribute('data-ok') === 'false') parts.push((result.textContent ?? '').trim());
  return parts.length > 0 ? parts.join(' | ') : null;
}

describe('QA · 「报红但能同步」（PRD A7 / A8 → O15 两通路互不冒充）', () => {
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

  it('O15：块⑤ 测出 403 红字 → 块④ 测出绿字：两块的结论各在各的块里', async () => {
    api.test.mockResolvedValueOnce(FORBIDDEN);
    await mount();

    /* 前提：红字确实出来了（否则下面那句「不串」是假绿） */
    await clickIn('data-cloud', '测试连接');
    expect(redIn('data-cloud')).toContain('账号或应用密码不对');
    expect(redIn('data-local')).toBeNull();

    api.test.mockResolvedValueOnce({ ok: true, detail: `目录可写：${LIVE_FOLDER}` });
    await clickIn('data-local', '测试连接');

    /* 块④ 拿到的是自己那句绿字；块⑤ 的红字仍在自己块里，一个字节没被冲掉 */
    const localResult = container.querySelector('[data-block="data-local"] .sync-cloud__result');
    expect(localResult?.getAttribute('data-ok')).toBe('true');
    expect(localResult?.textContent).toBe(`目录可写：${LIVE_FOLDER}`);
    expect(redIn('data-cloud')).toContain('账号或应用密码不对');
    /* 两次探测，载荷各按自己的通路拼（块④ 恒 `localfolder`、块⑤ 恒 `webdav`） */
    expect(api.test).toHaveBeenCalledTimes(2);
    expect((api.test.mock.calls[0][0] as { cloud: { mode: string } }).cloud.mode).toBe('webdav');
    expect((api.test.mock.calls[1][0] as { cloud: { mode: string } }).cloud.mode).toBe('localfolder');
  });

  it('A8 平移：结论只对测过的那份账号生效 —— 改了账号，上一次的红字立刻消失', async () => {
    api.test.mockResolvedValue(FORBIDDEN);
    await mount();
    await clickIn('data-cloud', '测试连接');
    expect(redIn('data-cloud')).not.toBeNull();

    /* 改账号：`testedKey` 与当前 key 不再相等 → 结论当帧作废（声明式兜底，不靠手写清理） */
    const user = container.querySelector(
      '[data-block="data-cloud"] input[placeholder="坚果云登录邮箱"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(user, 'other@example.com');
      user.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.querySelector('[data-block="data-cloud"] .sync-cloud__result')).toBeNull();
    expect(redIn('data-cloud')).toBeNull();
    /* 改完还能立刻再测（没有卡在「测试中…」） */
    const retest = Array.from(container.querySelectorAll('[data-block="data-cloud"] button'))
      .find((el) => el.textContent === '测试连接') as HTMLButtonElement;
    expect(retest.disabled).toBe(false);
  });

  it('A7：块④ 下「测试连接」存在且可点，结果是唯一一句「目录可写：绝对路径」', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: `目录可写：${LIVE_FOLDER}` });
    await mount();

    const test = Array.from(container.querySelectorAll('[data-block="data-local"] button'))
      .find((el) => el.textContent === '测试连接') as HTMLButtonElement;
    expect(test.disabled).toBe(false);
    await clickIn('data-local', '测试连接');

    /* 发下去的 `cloud` 必须带 localfolder + localRoot：后端靠它分派，不带就会去测 WebDAV */
    const sent = api.test.mock.calls[0][0] as { cloud: { mode: string; localRoot: string; enabled: boolean } };
    expect(sent.cloud.mode).toBe('localfolder');
    expect(sent.cloud.localRoot).toBe(LIVE_FOLDER);
    /* 探测是只读动作：通路关着也照测（`enabled` 恒 true，PRD §4.3） */
    expect(sent.cloud.enabled).toBe(true);

    const result = container.querySelector('[data-block="data-local"] .sync-cloud__result');
    expect(result?.textContent).toBe(`目录可写：${LIVE_FOLDER}`);
    expect(result?.getAttribute('data-ok')).toBe('true');
    /* localfolder 的 probe 只回一句，不渲染三关 */
    expect(result?.querySelector('.sync-cloud__steps')).toBeNull();
    expect(container.querySelector('.sync__error')).toBeNull();
  });

  it('A7 反向：块④ 状态行**零红字**（`hasSecret:false` 不再产出「密码未设置」这类红字来源）', async () => {
    await mount();
    expect(redIn('data-local')).toBeNull();
    const localStatus = container.querySelector('[data-block="data-local"] .sync-cloud__status');
    expect(localStatus?.textContent).not.toContain('密码未设置');
    /* 状态行按通路各投一份：块④ 是 `data-channel="folder"`、块⑤ 是 `webdav` */
    expect(localStatus?.getAttribute('data-channel')).toBe('folder');
    expect(container.querySelector('[data-block="data-cloud"] .sync-cloud__status')?.getAttribute('data-channel'))
      .toBe('webdav');
  });
});

