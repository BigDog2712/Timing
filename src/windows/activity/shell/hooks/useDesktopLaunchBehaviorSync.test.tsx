(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * [B5c] D5 ·「广播之后不会再回弹」的行为判据
 * -----------------------------------------------------------------------------
 * 双写解决的是**值**的一致（两份持久化同值）；这条解决的是**时序**：
 *
 * 旧形状：用户关掉「开机自启」→ 只有 `set_autostart(false)`（OS 关了、`autostart_enabled=0`），
 * 而 `appSettings.launchAtLogin` 还是出厂 true。此后只要这个 hook 的任一依赖变化
 * （比如用户在流媒体卡上改了「静默启动」），它就会用**旧值**再打一次
 * `cmd_set_launch_behavior(true, …)` —— 用户刚关掉的自启又被打开，而 UI 显示"关"。
 *
 * 所以这条钉两件事：
 *   ① 这个 hook 永远**用当前值**打 OS（没有缓存、没有旧值回放）；
 *   ② 值一变就重打一次 —— 双写的 `app-settings-changed` 广播让 shell 的
 *      `storedSettings` 换成新值，于是这里重打的就是**新值**，落在与 `set_autostart`
 *      同一个结果上（幂等，不会来回翻）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({
  setDesktopBehavior: vi.fn(),
  setLaunchBehavior: vi.fn(),
}));

vi.mock('../../platform/desktop/desktopBehaviorRuntimeGateway', () => ({ ...g }));

import { useDesktopLaunchBehaviorSync } from './useDesktopLaunchBehaviorSync';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings';

let container: HTMLDivElement;
let root: Root;

function Harness({ settings }: { settings: AppSettings }) {
  useDesktopLaunchBehaviorSync(settings, true);
  return null;
}

async function render(settings: AppSettings): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { settings }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  g.setDesktopBehavior.mockResolvedValue(undefined);
  g.setLaunchBehavior.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('[B5c] D5 · launch-behavior 同步只用当前值', () => {
  it('d511_the_first_push_uses_the_value_it_is_given', async () => {
    await render({ ...DEFAULT_SETTINGS, launchAtLogin: true, startMinimized: false });
    expect(g.setLaunchBehavior).toHaveBeenCalledTimes(1);
    expect(g.setLaunchBehavior).toHaveBeenCalledWith(true, false);
  });

  it('d512_toggling_off_repushes_false_and_never_replays_the_old_true', async () => {
    /* 这是"回弹"的靶点：把双写删掉，shell 里的值就还是 true，用户在别处改一次
       `startMinimized` 就会把这个 true 重新打给 OS。这里直接翻转值，验证重打的是新值。 */
    await render({ ...DEFAULT_SETTINGS, launchAtLogin: true, startMinimized: false });
    expect(g.setLaunchBehavior).toHaveBeenLastCalledWith(true, false);

    await render({ ...DEFAULT_SETTINGS, launchAtLogin: false, startMinimized: false });
    expect(g.setLaunchBehavior).toHaveBeenCalledTimes(2);
    expect(g.setLaunchBehavior).toHaveBeenLastCalledWith(false, false);

    /* 用户随后只改「静默启动」：打给 OS 的 launch 部分必须仍是**关**（不回放旧 true） */
    await render({ ...DEFAULT_SETTINGS, launchAtLogin: false, startMinimized: true });
    expect(g.setLaunchBehavior).toHaveBeenLastCalledWith(false, true);
    const launchArgs = g.setLaunchBehavior.mock.calls.map((call) => call[0]);
    expect(launchArgs.filter((value) => value === true)).toHaveLength(1);
  });

  it('d513_a_repaint_without_value_changes_does_not_touch_the_os', async () => {
    /* 依赖数组没变就不重打：否则设置页每敲一个键都往注册表写一次 */
    await render({ ...DEFAULT_SETTINGS, launchAtLogin: false, startMinimized: true });
    expect(g.setLaunchBehavior).toHaveBeenCalledTimes(1);
    await render({ ...DEFAULT_SETTINGS, launchAtLogin: false, startMinimized: true });
    expect(g.setLaunchBehavior).toHaveBeenCalledTimes(1);
  });
});
