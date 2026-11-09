/**
 * Timing — 悬浮条/通知按钮的接收端（V0.11.22，PRD P7；[V0.11.27] 兜底通道；[V0.11.28] 双事件）
 * -----------------------------------------------------------------------------
 * 这条链是「Kotlin 探测 → 投事件 → 前端执行动作」。三个环节里最容易被写坏的是
 * **注册的取消**：`addPluginListener` 是异步的，组件在注册完成之前卸载时如果不补一次
 * `unregister`，这个 channel 会一直留在插件里；下次重挂载再多一份，于是「点一下悬浮窗，
 * 计时被切换两次」——看起来像随机暂停，实际是监听器泄漏。
 *
 * [V0.11.27] 真机上还暴露了另一头：事件那条链在 WebView 被销毁 / 监听没挂上时**静默丢**，
 * 用户看到「点了没反应」。所以原生侧按下的那一刻会先记一个 90 秒有效的标记，本 hook 回到
 * 前台时问一次 `overlayTakeTap` 补做。
 *
 * [V0.11.28] 通知栏多了「结束」按钮，于是**动作有两种**。判据的重点从「有没有补做」变成
 * 「补做的是哪一个」：把「结束」当「切换」执行，会把已经结束的计时又开起来。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  unregister: vi.fn(),
  togglePause: vi.fn(),
  stop: vi.fn(),
  invoke: vi.fn(),
  pending: { on: false, ageMs: -1, action: '' as string },
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: mocks.add,
  invoke: mocks.invoke,
}));
vi.mock('./useTimerActions', () => ({
  useTimerActions: () => ({ togglePause: mocks.togglePause, stop: mocks.stop }),
}));
vi.mock('../lib/platform', () => ({ IS_MOBILE: true }));
vi.mock('../services/ipc', () => ({ isTauri: () => true }));

const { usePillAction } = await import('./usePillAction');

/** 只挂这个 hook 的空组件。 */
function Probe() {
  usePillAction();
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mocks.add.mockReset();
  mocks.unregister.mockReset();
  mocks.togglePause.mockReset();
  mocks.stop.mockReset();
  mocks.invoke.mockReset();
  mocks.pending = { on: false, ageMs: -1, action: '' };
  mocks.add.mockResolvedValue({ unregister: mocks.unregister });
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (String(cmd).endsWith('|overlayTakeTap')) {
      return { pending: mocks.pending.on, ageMs: mocks.pending.ageMs, action: mocks.pending.action };
    }
    return null;
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 渲染并等挂载期的异步（注册 + 首次查标记）落定。 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** 按事件名取注册出来的回调（两条 channel：pill:toggle / pill:finish）。 */
function handlerOf(event: string): () => void {
  const call = mocks.add.mock.calls.find((c) => c[1] === event);
  if (!call) throw new Error(`没有注册 ${event} 的监听`);
  return call[2] as () => void;
}

describe('悬浮条/通知按钮的接收端（P7）', () => {
  /** 注册参数是契约：插件名与两个事件名必须与 Kotlin 侧一致。 */
  it('p7_registers_both_plugin_channels', async () => {
    await mount();
    expect(mocks.add).toHaveBeenCalledTimes(2);
    const channels = mocks.add.mock.calls.map((c) => `${String(c[0])}|${String(c[1])}`).sort();
    expect(channels).toEqual(['timing-native|pill:finish', 'timing-native|pill:toggle']);
    for (const call of mocks.add.mock.calls) expect(typeof call[2]).toBe('function');
  });

  /** 短按 → 走主界面那颗大按钮的同一套动作（idle 开始 / running 暂停 / paused 继续）。 */
  it('p7_toggle_event_calls_toggle_pause_only', async () => {
    await mount();
    act(() => handlerOf('pill:toggle')());
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
    expect(mocks.stop, '短按不该结束计时').not.toHaveBeenCalled();
  });

  /** 通知「结束」→ 走停止动作，且**不能**顺手切换一次（那会把计时重新开起来）。 */
  it('p8_finish_event_calls_stop_only', async () => {
    await mount();
    act(() => handlerOf('pill:finish')());
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.togglePause, '结束事件不该同时切换').not.toHaveBeenCalled();
  });

  /**
   * 顺序：**先**清标记再执行。
   *
   * 反过来的话，执行那一两百毫秒里用户切到后台再回来，兜底通道会看到标记还在，
   * 于是同一按被执行两下（表现是「点一下暂停又继续」）。
   */
  it('p7_event_clears_the_pending_mark_before_acting', async () => {
    await mount();
    mocks.togglePause.mockClear();
    mocks.invoke.mockClear();

    act(() => handlerOf('pill:toggle')());

    const clearCall = mocks.invoke.mock.calls.findIndex((c) =>
      String(c[0]).endsWith('|overlayClearTap'),
    );
    expect(clearCall, '事件回调里没有清标记 → 兜底通道会再切一次').toBeGreaterThanOrEqual(0);
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);

    const order = mocks.invoke.mock.invocationCallOrder[clearCall];
    expect(order).toBeLessThan(mocks.togglePause.mock.invocationCallOrder[0]);
  });

  /** 挂载即查一次：App 是被悬浮条拉起来的，首帧就该补做，不能等用户手动切前后台。 */
  it('p8_mount_drains_the_pending_mark', async () => {
    mocks.pending = { on: true, ageMs: 1_200, action: 'toggle' };
    await mount();
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
  });

  /**
   * 兜底通道必须按标记里的动作补做。
   *
   * 前提是「点了结束、但没人接」——这时把 kind 丢了、一律当 toggle 执行，用户看到的是
   * 「我点了结束，结果它又跑起来了」，比不补做更让人害怕。
   */
  it('p8_drain_honours_the_recorded_action', async () => {
    mocks.pending = { on: true, ageMs: 800, action: 'finish' };
    await mount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.togglePause).not.toHaveBeenCalled();
  });

  /** 0.11.27 的标记没有动作类型（空串）：那时只有「切换」，补做就该是切换。 */
  it('p8_legacy_mark_without_action_still_toggles', async () => {
    mocks.pending = { on: true, ageMs: 500, action: '' };
    await mount();
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  /** 太旧的标记不认：昨天按的那一下不该在今天打开 App 时把计时切走。 */
  it('p8_stale_mark_is_ignored', async () => {
    mocks.pending = { on: true, ageMs: 10 * 60_000, action: 'finish' };
    await mount();
    expect(mocks.togglePause).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  /** 没有标记时回前台什么都不做（否则每次回前台都会切一下计时）。 */
  it('p8_foreground_without_mark_does_nothing', async () => {
    await mount();
    mocks.togglePause.mockClear();
    mocks.stop.mockClear();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.togglePause).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  /** 卸载要注销**两条** channel：漏一条就等于同一按被执行多次。 */
  it('p7_unmount_unregisters_every_channel', async () => {
    await mount();
    act(() => root.unmount());
    expect(mocks.unregister).toHaveBeenCalledTimes(2);
  });
});
