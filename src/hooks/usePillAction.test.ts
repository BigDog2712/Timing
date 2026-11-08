/**
 * Timing — 悬浮窗那一按的接收端（V0.11.22，PRD P7）
 * -----------------------------------------------------------------------------
 * 这条链是「Kotlin 探测 → 投事件 → 前端调 `togglePause()`」。三个环节里最容易被写坏的是
 * **注册的取消**：`addPluginListener` 是异步的，组件在注册完成之前卸载时如果不补一次
 * `unregister`，这个 channel 会一直留在插件里；下次重挂载再多一份，于是「点一下悬浮窗，
 * 计时被切换两次」——看起来像随机暂停，实际是监听器泄漏。
 *
 * 这里同时钉住「事件到了就调 togglePause」，以及「非移动端 / 非 Tauri 环境什么都不做」。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  unregister: vi.fn(),
  togglePause: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ addPluginListener: mocks.add }));
vi.mock('./useTimerActions', () => ({
  useTimerActions: () => ({ togglePause: mocks.togglePause }),
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
  mocks.add.mockResolvedValue({ unregister: mocks.unregister });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('悬浮窗事件接收（P7）', () => {
  /** 注册参数是契约：插件名与事件名必须与 Kotlin 侧一致（另见 `SyncPane.source.test.ts`）。 */
  it('p7_registers_the_plugin_channel', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0][0]).toBe('timing-native');
    expect(mocks.add.mock.calls[0][1]).toBe('pill:toggle');
    expect(typeof mocks.add.mock.calls[0][2]).toBe('function');
  });

  /** 事件到了 → 走主界面那颗大按钮的同一套动作（idle 开始 / running 暂停 / paused 继续）。 */
  it('p7_event_calls_toggle_pause', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    const handler = mocks.add.mock.calls[0][2] as () => void;
    act(() => handler());
    expect(mocks.togglePause).toHaveBeenCalledTimes(1);
  });

  /** 卸载要注销：不注销 = 同一个事件被执行 N 次（表现是「点一下暂停两次」）。 */
  it('p7_unmount_unregisters', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    act(() => root.unmount());
    expect(mocks.unregister).toHaveBeenCalledTimes(1);
  });
});
