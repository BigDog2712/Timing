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
import { CLOUD_DIR_HINT } from './mdSyncCopy';
import { useMdSyncDraft } from './useMdSyncDraft';
import type { MdSyncDraft } from './useMdSyncDraft';

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
  /* 测试要能直接调 `setSharedFile`：这里把草稿抬到一个模块变量上 */
  draftRef = draft;
  return createElement('div', null,
    createElement(MdSyncCloudCard, { draft }),
    createElement('button', { type: 'button', onClick: () => void draft.save() }, '保存'));
}

let draftRef: MdSyncDraft | null = null;

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
    /* [V0.11.16] C20 已删：本地目录不再有那句「换机器时把它同步过去即可」 */
    expect(container.textContent).not.toContain('换机器时把它同步过去即可');
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

  /* ===== [V0.11.16] 三关逐步点亮（PRD E3 / E6 / E7）===== */

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

  it('「测试连接」用的是 resolvedBindings（与保存同一个数组）', async () => {
    api.test.mockResolvedValueOnce({ ok: true, detail: '连接正常' });
    await mount();
    /* 在块①那个单框里改一下文件名（统一意图），但**先不保存** */
    await act(async () => { draftRef?.setSharedFile('{date}-asd.md'); await Promise.resolve(); });
    await click('测试连接');
    const config = api.test.mock.calls[0][0];
    expect(config.bindings[0].file).toBe('{date}-asd.md');
  });

  /* ===== [V0.11.16] 默认预填（PRD E1 / E2，裁决 Q1）===== */

  it('E1：从未配置过云端时，打开就在 WebDAV 段，且两个框的**值**（不是 placeholder）已预填', async () => {
    const bare = viewWith('webdav');
    api.get.mockResolvedValue({ ...bare, config: { ...bare.config, cloud: null } });
    await mount();
    await act(async () => { await Promise.resolve(); });

    /* [QA F1] 不点任何分段：默认就停在 WebDAV。这一帧正是 v0.11.16 首版做错的地方
       （`emptyCloud().mode` 留成 `localfolder`，预填值藏在另一个分段后面）。 */
    const segs = Array.from(container.querySelectorAll('.seg__item'));
    const on = segs.filter((item) => item.getAttribute('data-on') === 'true').map((item) => item.textContent);
    expect(on).toEqual(['WebDAV']);
    /* WebDAV 段的字段真的挂上了：否则下面那两个值只是「藏在没渲染的树里」 */
    expect(container.textContent).toContain('服务地址');

    const urls = Array.from(container.querySelectorAll('input')).map((el) => el.value);
    expect(urls).toContain('https://dav.jianguoyun.com/dav/');
    expect(urls).toContain('/Timing');
    /* [V0.11.17] B3：远端目录框下有一行静态小字，逐字等于常量 */
    expect(container.textContent).toContain(CLOUD_DIR_HINT);
    /* 「值」而不是「灰字」：placeholder 是提示，用户必须先删掉才能填自己的 */
    const baseUrl = container.querySelector('input[placeholder="https://dav.jianguoyun.com/dav/"]') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://dav.jianguoyun.com/dav/');
  });

  it('E2：已配置过的地址原样显示，不被默认值改写', async () => {
    const mine = viewWith('webdav');
    api.get.mockResolvedValue({
      ...mine,
      config: {
        ...mine.config,
        cloud: { ...mine.config.cloud!, baseUrl: 'https://synology.example.com/dav/', basePath: '/Timing/md' },
      },
    });
    await mount();
    await act(async () => { await Promise.resolve(); });

    const urls = Array.from(container.querySelectorAll('input')).map((el) => el.value);
    expect(urls).toContain('https://synology.example.com/dav/');
    expect(urls).toContain('/Timing/md');
    expect(urls).not.toContain('https://dav.jianguoyun.com/dav/');
  });

  it('手机端不出现「本地目录」；读到 localfolder 配置时给说明，保存落成 webdav', async () => {
    host.mobile = true;
    api.get.mockResolvedValue(viewWith('localfolder'));
    await mount();
    /* 视图是异步回填的：多冲一次微任务，否则断言的是「还没读到配置」的那一帧 */
    await act(async () => { await Promise.resolve(); });
    const modes = Array.from(container.querySelectorAll('.seg__item')).map((item) => item.textContent);
    expect(modes).toEqual(['WebDAV']);
    expect(container.textContent).toContain('服务地址');
    /* 改用户配置必须当面说：没有这行说明就成了静默改配置 */
    expect(container.querySelector('[data-converted="true"]')).not.toBeNull();
    expect(container.textContent).toContain('手机端不支持');
    /* 显示与落库必须一致：界面上是 WebDAV，存下去的也得是 webdav */
    await click('保存');
    expect(api.save.mock.calls[0][0].cloud.mode).toBe('webdav');
  });

  /* [V0.11.19 变更 A] 块④ 那一行只读文字：四句选择器在 `mdSyncAuto.ts`，这里钉
     「状态真的接到界面上」；没接上时它永远是常态句（T03 刻意留的那一档）。 */
  it('往期清理只在 ready 分支里显示一行，且四句按状态选', async () => {
    const idle = '云端只保留今天的日记，更早的会在同步后删除。';
    await mount();
    await act(async () => { await Promise.resolve(); });
    const line = () => container.querySelector('[data-purge="true"]')?.textContent;
    expect(line()).toBe(idle);

    const view = viewWith('webdav');
    api.get.mockResolvedValue({ ...view,
      cloud: { ...view.cloud, purge: { paused: false, deleted: 5, failed: 0 } } });
    await act(async () => { root.unmount(); });
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(line()).toBe('云端只保留今天的日记；上次清理删了 5 份。');

    /* 没填全的那一档不叠加这一行（「云端还没填全」只显示它自己那句） */
    api.get.mockResolvedValue({
      ...view,
      config: { ...view.config, cloud: { ...view.config.cloud!, baseUrl: '' } },
    });
    await act(async () => { root.unmount(); });
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(line()).toBeUndefined();
  });
});
