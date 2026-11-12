/**
 * Timing — 悬浮条/通知按钮的接收端（V0.11.22 起；[V0.11.32] 换投递方式后重写）
 * -----------------------------------------------------------------------------
 * 这一份测的是**接得住**：原生那一按投进来之后，到底有没有执行、执行的是哪一个动作。
 *
 * [V0.11.32] 换了投递方式，判据跟着换：入口从 Tauri 的 `addPluginListener` 变成
 * `window.__timingPillTap`（原生 `evaluateJavascript` 直接调）。这不只是换个写法——
 * 旧的注册那一步走 Tauri 自己的 Jackson 反射，失败会被 `.catch()` 吞掉，表现就是
 * 主人报的「点按只有圆点展开、计时一动不动」。所以这里断言的是**全局入口本身**：
 * 挂载后必须存在、卸载后必须消失（留着旧闭包会指向已卸载的组件）。
 *
 * 动作语义三条（都与主界面同一套 action，不在这里复制状态机）：
 *   - `toggle`：待机 → 用系统事项「未归类」开始（未命名计时）；跑步 → 暂停；暂停 → 继续；
 *   - `finish`：结束，并且走 `useStopNaming`（未命名时会在结束后面板问名字）；
 *   - `open`  ：长按回 App，落点切到计时页。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_ITEM_ID } from '../types/domain';

const mocks = vi.hoisted(() => ({
  togglePause: vi.fn(),
  start: vi.fn(),
  stopWithNaming: vi.fn(),
  refresh: vi.fn(),
  setTab: vi.fn(),
  closeSheet: vi.fn(),
  invoke: vi.fn(),
  status: 'idle' as 'idle' | 'running' | 'paused',
  pending: { on: false, ageMs: -1, action: '' as string },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./useTimerActions', () => ({
  useTimerActions: () => ({
    togglePause: mocks.togglePause,
    start: mocks.start,
  }),
}));
vi.mock('./useStopNaming', () => ({ useStopNaming: () => mocks.stopWithNaming }));
vi.mock('../lib/platform', () => ({ IS_MOBILE: true }));
vi.mock('../services/ipc', () => ({ isTauri: () => true }));
vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    getState: () => ({
      state: { status: mocks.status },
      refresh: mocks.refresh,
    }),
  },
}));
vi.mock('../stores/mobileUiStore', () => ({
  useMobileUiStore: {
    getState: () => ({ setTab: mocks.setTab, closeSheet: mocks.closeSheet }),
  },
}));

const { usePillAction } = await import('./usePillAction');

/** 原生调的那个全局入口（名字必须与 Kotlin 的 `JS_ENTRY` 一致）。 */
const ENTRY = '__timingPillTap';

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
  mocks.togglePause.mockReset();
  mocks.start.mockReset();
  mocks.stopWithNaming.mockReset();
  mocks.refresh.mockReset();
  mocks.setTab.mockReset();
  mocks.closeSheet.mockReset();
  mocks.invoke.mockReset();
  mocks.status = 'idle';
  mocks.pending = { on: false, ageMs: -1, action: '' };
  mocks.refresh.mockResolvedValue(undefined);
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

/** 渲染并等挂载期的异步（首次查标记）落定。 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await flush();
}

/** 把已经排队的 promise 链推完（`run` 里有 clear → refresh/start 多跳）。 */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

/** 模拟原生那一按。 */
async function tap(kind: string): Promise<void> {
  await act(async () => {
    (window as unknown as Record<string, (k: string) => string>)[ENTRY](kind);
  });
  await flush();
}

describe('悬浮条/通知按钮的接收端（P7 / V0.11.32）', () => {
  /** 入口必须由本 hook 挂上：原生调的就是它，没挂上等于这一按投进了空气。 */
  it('exposes_the_js_entry_while_mounted', async () => {
    await mount();
    const entry = (window as unknown as Record<string, unknown>)[ENTRY];
    expect(typeof entry).toBe('function');
    expect((entry as (k: string) => string)('toggle')).toBe('ok');
    await flush();
  });

  /** 待机点按 = 开始**未命名**的一笔（悬浮条上没有选事项的位置）。 */
  it('tap_when_idle_starts_an_unnamed_timer', async () => {
    mocks.status = 'idle';
    await mount();
    await tap('toggle');
    expect(mocks.start).toHaveBeenCalledWith(SYSTEM_ITEM_ID);
    expect(mocks.togglePause, '待机时不该走切换').not.toHaveBeenCalled();
    expect(mocks.stopWithNaming).not.toHaveBeenCalled();
  });

  /** 计时中点按 = 暂停 / 继续：走主界面大按钮那一套，不在这里另写状态机。 */
  it('tap_while_running_toggles_pause', async () => {
    mocks.status = 'running';
    await mount();
    await tap('toggle');
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
    expect(mocks.start, '跑步时又开一段等于两条记录').not.toHaveBeenCalled();
    expect(mocks.stopWithNaming).not.toHaveBeenCalled();
  });

  /** 通知「结束」→ 走命名出口（未命名的那一笔结束后面板会问名字）。 */
  it('finish_goes_through_the_naming_exit', async () => {
    mocks.status = 'running';
    await mount();
    await tap('finish');
    expect(mocks.stopWithNaming).toHaveBeenCalledTimes(1);
    expect(mocks.togglePause, '结束不该顺手切换一次').not.toHaveBeenCalled();
  });

  /** 长按回 App：落点必须是计时页（主人原话「应跳转至计时界面」）。 */
  it('open_lands_on_the_timer_tab', async () => {
    await mount();
    await tap('open');
    expect(mocks.setTab).toHaveBeenCalledWith('timer');
    expect(mocks.closeSheet, '回到的应该是计时页，不是上次那张表').toHaveBeenCalled();
    expect(mocks.togglePause).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  /**
   * 顺序：**先**清标记再执行。
   *
   * 反过来的话，执行那一两百毫秒里用户切到后台再回来，兜底通道会看到标记还在，
   * 于是同一按被执行两下（表现是「点一下暂停又继续」）。
   */
  it('clears_the_pending_mark_before_acting', async () => {
    mocks.status = 'running';
    await mount();
    mocks.invoke.mockClear();
    mocks.togglePause.mockClear();

    await tap('toggle');

    const clearCall = mocks.invoke.mock.calls.findIndex((c) =>
      String(c[0]).endsWith('|overlayClearTap'),
    );
    expect(clearCall, '执行前没有清标记 → 兜底通道会再切一次').toBeGreaterThanOrEqual(0);
    const clearOrder = mocks.invoke.mock.invocationCallOrder[clearCall];
    expect(clearOrder).toBeLessThan(mocks.togglePause.mock.invocationCallOrder[0]);
  });

  /** 挂载即查一次：App 是被悬浮条拉起来的，首帧就该补做。 */
  it('mount_drains_the_pending_mark', async () => {
    mocks.status = 'running';
    mocks.pending = { on: true, ageMs: 1_200, action: 'toggle' };
    await mount();
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
  });

  /**
   * 补做必须按标记里的动作执行。
   *
   * 把「结束」当「切换」补做，用户看到的是「我点了结束，结果它又跑起来了」——
   * 比不补做更让人害怕。
   */
  it('drain_honours_the_recorded_action', async () => {
    mocks.pending = { on: true, ageMs: 800, action: 'finish' };
    await mount();
    expect(mocks.stopWithNaming).toHaveBeenCalledTimes(1);
    expect(mocks.togglePause).not.toHaveBeenCalled();
  });

  /**
   * 0.11.27 的标记没有动作类型（空串）：那时只有「切换」，补做就该走切换。
   * 「切换」本身仍是按真值分派的：跑步 → 暂停，待机 → 开始（见上面两条）。
   */
  it('legacy_mark_without_action_still_toggles', async () => {
    mocks.status = 'running';
    mocks.pending = { on: true, ageMs: 500, action: '' };
    await mount();
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  /** 太旧的标记不认：昨天按的那一下不该在今天打开 App 时把计时切走。 */
  it('stale_mark_is_ignored', async () => {
    mocks.pending = { on: true, ageMs: 10 * 60_000, action: 'finish' };
    await mount();
    expect(mocks.togglePause).not.toHaveBeenCalled();
    expect(mocks.stopWithNaming).not.toHaveBeenCalled();
  });

  /** 没有标记时回前台什么都不做（否则每次回前台都会切一下计时）。 */
  it('foreground_without_mark_does_nothing', async () => {
    await mount();
    mocks.togglePause.mockClear();
    mocks.start.mockClear();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(mocks.togglePause).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  /** 卸载要把入口撤掉：留着旧闭包会指向已卸载的组件（下次按到的是上一份 state）。 */
  it('unmount_removes_the_js_entry', async () => {
    await mount();
    expect((window as unknown as Record<string, unknown>)[ENTRY]).toBeTypeOf('function');
    act(() => root.unmount());
    expect((window as unknown as Record<string, unknown>)[ENTRY]).toBeUndefined();
  });
});
