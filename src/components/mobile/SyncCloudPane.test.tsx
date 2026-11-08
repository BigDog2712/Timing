/**
 * Timing — 移动端云端通道的判据（V0.11.21，PRD P1–P7）
 * -----------------------------------------------------------------------------
 * 这一页是「一条能跑的路没有门」的补门：`sync_once` 早就能跑云端那一轮，手机上却
 * 没有任何地方能填地址、密码、三档。所以判据分两类，缺一类就等于没做：
 *
 * - **填得进去**：三档切档保留分钟数、切通道保留已填字段；
 * - **填不对会说话**：没填全只说那一句、密码三分语义、测试连接红在哪一关。
 *
 * 组件是纯 props（不碰 `ipc` / `mobileNative`），所以这里不需要 mock 传输层——
 * 也就是说不存在「mock 绿了、真机红」那种假绿（本项目踩过三次的形态）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncCloud, MdSyncTestResult, MdSyncViewCloud } from '../../types/domain';
import { SyncCloudPane } from './SyncCloudPane';

const CLOUD: MdSyncCloud = {
  enabled: true,
  mode: 'webdav',
  localRoot: '',
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  basePath: '/Timing',
  user: 'me@example.com',
};

function view(cloud: MdSyncCloud | null, status: Partial<MdSyncViewCloud['cloud']> = {}): MdSyncViewCloud {
  return {
    today: '2026-11-21',
    config: {
      enabled: true,
      pollSecs: 900,
      bindings: [
        { kind: 'timers', enabled: true, root: '', file: '{date}.md', heading: '#### 事项计时' },
      ],
      cloud,
    },
    cloud: {
      enabled: cloud?.enabled ?? false,
      mode: 'webdav',
      hasSecret: true,
      todayPushed: false,
      pendingDates: [],
      lastError: null,
      ...status,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

let host: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onTest = vi.fn<(config: unknown, secret?: string | null) => Promise<MdSyncTestResult>>();

function mount(next: MdSyncViewCloud) {
  act(() => {
    root.render(createElement(SyncCloudPane, { view: next, busy: false, onSave, onTest }));
  });
}

const $ = <T extends Element>(selector: string): T => {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`找不到 ${selector}`);
  return found;
};

const text = () => host.textContent ?? '';

/** 按 data 锚点点一下（三个分段、按钮都靠它定位，不按文案找——文案会改） */
function click(selector: string) {
  act(() => {
    $<HTMLElement>(selector).click();
  });
}

/** React 19 的 onChange 走原生 `input` 事件；直接改 `value` 不会触发（受控组件）。 */
function type(selector: string, value: string) {
  const input = $<HTMLInputElement>(selector);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSave.mockClear();
  onTest.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('手机端云端通道', () => {
  /** P2：没碰密码框 → 保存时**没有** secret（`undefined`），不是空串。 */
  it('p2_untouched_password_sends_no_secret', () => {
    mount(view(CLOUD));
    click('.m-cloud__actions .m-btn--primary');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBeUndefined();
  });

  /** P3：输入密码 → 原串；点「清除密码」→ 空串（后端语义 = 清空）。 */
  it('p3_password_tristate_input_and_clear', () => {
    mount(view(CLOUD));
    type('[data-cloud-field="secret"]', 'app-pass');
    click('.m-cloud__actions .m-btn--primary');
    expect(onSave.mock.calls[0][1]).toBe('app-pass');

    onSave.mockClear();
    click('.m-cloud__actions .m-btn--small:last-child');
    click('.m-cloud__actions .m-btn--primary');
    expect(onSave.mock.calls[0][1]).toBe('');
  });

  /** P5：切到「只用本地」只改 enabled，地址 / 远端目录 / 账号一个字节不丢。 */
  it('p5_switching_to_local_keeps_the_filled_fields', () => {
    mount(view(CLOUD));
    click('[data-cloud-channel="local"]');
    click('.m-cloud__actions .m-btn--primary');
    const config = onSave.mock.calls[0][0] as { cloud: MdSyncCloud };
    expect(config.cloud.enabled).toBe(false);
    expect(config.cloud.baseUrl).toBe(CLOUD.baseUrl);
    expect(config.cloud.basePath).toBe(CLOUD.basePath);
    expect(config.cloud.user).toBe(CLOUD.user);
  });

  /** P4：开了但没填全 → 只那一句，不叠「今天还没上传」。 */
  it('p4_incomplete_cloud_says_only_one_sentence', () => {
    mount(view({ ...CLOUD, user: '  ' }));
    expect(text()).toContain('云端还没填全，暂时不会同步。');
    expect(text()).not.toContain('今天还没上传');
  });

  /** P1：定时 30 → 智能 → 定时，分钟数仍是 30（切档不许把用户填的盖回默认）。 */
  it('p1_switching_tiers_keeps_the_minutes', () => {
    mount(view({ ...CLOUD, auto: { schedule: 'interval', intervalMinutes: 30 } }));
    click('[data-cloud-tier="smart"]');
    click('[data-cloud-tier="interval"]');
    click('.m-cloud__actions .m-btn--primary');
    const config = onSave.mock.calls[0][0] as { cloud: MdSyncCloud };
    expect(config.cloud.auto).toEqual({ schedule: 'interval', intervalMinutes: 30 });
  });

  /** P7：测试连接红在「目录」→ 只显示走过的关，后面那关不出现。 */
  it('p7_failed_step_is_the_only_detail', async () => {
    onTest.mockResolvedValue({
      ok: false,
      detail: '目录不存在',
      steps: [
        { key: 'account', ok: true, detail: null },
        { key: 'dir', ok: false, detail: '这一级目录建不出来' },
      ],
    });
    mount(view(CLOUD));
    await act(async () => {
      $<HTMLButtonElement>('.m-cloud__actions .m-btn--small').click();
    });
    expect(text()).toContain('这一级目录建不出来');
    expect(text()).not.toContain('写入');
  });
});
