/**
 * 「从真源重读」的判据（[0.12.1 归一]）
 * -----------------------------------------------------------------------------
 * 守两件事：
 *  1. 注入了 loader 时，安装后**立刻读一次**，并把结果写进本窗缓存（首帧缓存）+ 应用；
 *  2. `null`（库里没写过 / 读失败）时**什么都不做** —— 绝不能拿默认值盖掉用户设置；
 *     收到 `PILL_PREFS_EVENT` 信号时再读一次（信号本身不带值）。
 *
 * 每个用例用 `vi.resetModules()` + 动态 import 取一份新模块：`installAppearanceSync`
 * 有一次性的 `installed` 守卫（防 StrictMode 双挂载），同一个模块实例装不了第二遍。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
  emit: vi.fn(() => Promise.resolve()),
}));

import { listen } from '@tauri-apps/api/event';
import { DEFAULT_HANDLE_BINDINGS } from './handleCatalog';
import { PILL_PREFS_EVENT } from './pillAppearance';
import type { PillPrefs } from './pillAppearance';

const listenMock = vi.mocked(listen);

function snapshot(): PillPrefs {
  return {
    appearance: { textOpacity: 0.3, bgOpacity: 0.7, floatForm: 'dot' },
    handles: DEFAULT_HANDLE_BINDINGS,
  };
}

/** 让已排队的 promise 链跑完（`refresh` 是 fire-and-forget 的） */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 取最后一次传给 `listen` 的处理函数（模拟收到跨窗信号） */
function signalHandler(): () => void {
  const calls = listenMock.mock.calls.filter(([name]) => name === PILL_PREFS_EVENT);
  expect(calls.length, '没有订阅跨窗信号').toBeGreaterThan(0);
  return calls[calls.length - 1][1] as unknown as () => void;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  listenMock.mockClear();
});

describe('installAppearanceSync', () => {
  it('s1_install_reads_the_source_once_and_writes_the_first_frame_cache', async () => {
    const { installAppearanceSync } = await import('./appearanceSync');
    const load = vi.fn(async () => snapshot());

    installAppearanceSync({ load });
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    /* 缓存写好了：下一次冷启动的首帧才正确（localStorage 只做这件事） */
    expect(localStorage.getItem('timing.appearance.v1')).toContain('"dot"');
    expect(localStorage.getItem('timing.appearance.v1')).toContain('"textOpacity":0.3');
    expect(localStorage.getItem('timing.handles.v1')).toContain('"full"');

    /* 收到无载荷信号 → 再读一次（同屏改设置时不必等焦点切换） */
    signalHandler()();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('s2_null_from_the_source_never_overwrites_the_current_values', async () => {
    const { installAppearanceSync } = await import('./appearanceSync');
    const load = vi.fn(async () => null);

    installAppearanceSync({ load });
    await flush();

    expect(load).toHaveBeenCalled();
    /* 读不到就保留现值：不写缓存、不填默认 */
    expect(localStorage.getItem('timing.appearance.v1')).toBeNull();
    expect(localStorage.getItem('timing.handles.v1')).toBeNull();
  });
});
