/**
 * Timing — 事项默认时长的**唯一写入点**（[本轮]）：串行 + 冷启动兜底
 * -----------------------------------------------------------------------------
 * 这两条都不是“代码洁癖”，各自对应一次真实的数据丢失：
 *   · **串行**：宿主 `update_settings` 对 `itemsTimers` 是整键替换。两次快速保存若并发，
 *     会读到同一份旧基底 → 后写的那次把前一条的改动整片盖掉（症状：连点两条「保存」，
 *     只有最后一条的时长生效）。
 *   · **冷启动兜底**：`useAppBootstrap` 的 `Promise.all` 一旦 reject，settings store 停在
 *     `DEFAULT_SETTINGS`（`itemsTimers: {}`, `loaded: false`）。此时写一条时长 = 拿空基底
 *     整表覆盖，把宿主里**所有**其他事项的时长清掉。
 *
 * 判据只钉这三件事，不钉实现：并发时第二次的基底含第一次的结果、冷启动先 reload 再写、
 * 一次失败不把队列卡死。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Timers = Record<string, number>;
interface SettingsLike {
  itemsTimers: Timers;
}

const h = vi.hoisted(() => {
  const state: { loaded: boolean; settings: SettingsLike } = {
    loaded: true,
    settings: { itemsTimers: {} },
  };
  return {
    state,
    reload: vi.fn(async () => state.settings),
    setSettings: vi.fn((next: SettingsLike) => {
      state.settings = next;
      state.loaded = true;
    }),
    update: vi.fn(async (patch: SettingsLike) => ({ itemsTimers: patch.itemsTimers })),
  };
});

vi.mock('./api', () => ({ settingsApi: { update: h.update } }));
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      loaded: h.state.loaded,
      settings: h.state.settings,
      reload: h.reload,
      setSettings: h.setSettings,
    }),
  },
}));

const { writeItemTimer } = await import('./itemTimerWrite');

/** 让挂起的微任务/宏任务跑一轮（队列的每一环都在 microtask 上启动） */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.state.loaded = true;
  h.state.settings = { itemsTimers: {} };
  h.reload.mockClear();
  h.setSettings.mockClear();
  h.update.mockReset();
  h.update.mockImplementation(async (patch: SettingsLike) => ({ itemsTimers: patch.itemsTimers }));
});

describe('writeItemTimer · 串行与冷启动', () => {
  it('itw01_two_rapid_writes_are_serialised_so_the_second_base_keeps_the_first', async () => {
    /* 第一次 update 挂起：如果两次写入并发，第二次会在第一次落库前读基底 → 只剩 {2:30} */
    let releaseFirst: (() => void) | null = null;
    h.update.mockImplementationOnce((patch: SettingsLike) => new Promise((resolve) => {
      releaseFirst = () => resolve({ itemsTimers: patch.itemsTimers });
    }));

    const first = writeItemTimer(1, 25);
    const second = writeItemTimer(2, 30);
    await tick();
    /* 第一环挂在 network 上：此时第二次**必须**还没发 update（串行的判据） */
    expect(h.update).toHaveBeenCalledTimes(1);
    (releaseFirst as (() => void) | null)?.();
    await first;
    await second;

    expect(h.update).toHaveBeenCalledTimes(2);
    const secondPatch = h.update.mock.calls[1][0];
    expect(secondPatch.itemsTimers).toEqual({ "1": 25, "2": 30 });
    /* store 里也是两份都在 */
    expect(h.state.settings.itemsTimers).toEqual({ "1": 25, "2": 30 });
  });

  it('itw02_a_cold_store_is_reloaded_before_the_base_is_read', async () => {
    /* 冷启动：store 停在 DEFAULT_SETTINGS（空 itemsTimers + loaded=false） */
    h.state.loaded = false;
    h.state.settings = { itemsTimers: {} };
    h.reload.mockImplementation(async () => {
      h.state.settings = { itemsTimers: { "9": 10 } };
      h.state.loaded = true;
      return h.state.settings;
    });

    await writeItemTimer(1, 25);

    expect(h.reload).toHaveBeenCalledTimes(1);
    /* 基底是 reload 回来的那份，不是空表 —— 否则 9 号的 10 分钟会被整表覆盖掉 */
    expect(h.update).toHaveBeenCalledWith({ itemsTimers: { "9": 10, "1": 25 } });
    expect(h.reload.mock.invocationCallOrder[0]).toBeLessThan(h.update.mock.invocationCallOrder[0]);
  });

  it('itw03_a_warm_store_does_not_reload', async () => {
    h.state.settings = { itemsTimers: { "9": 10 } };

    await writeItemTimer(9, null);

    expect(h.reload).not.toHaveBeenCalled();
    /* `null` = 只删这一个键，别的事项原样保留 */
    expect(h.update).toHaveBeenCalledWith({ itemsTimers: {} });
  });

  it('itw04_one_failed_write_does_not_wedge_the_queue', async () => {
    h.update.mockRejectedValueOnce(new Error('SETTINGS_WRITE_FAILED'));

    await expect(writeItemTimer(1, 25)).rejects.toThrow('SETTINGS_WRITE_FAILED');
    /* 失败那次没有回写 store，基底仍是空 → 第二次只写自己的键 */
    await writeItemTimer(2, 30);

    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.update.mock.calls[1][0].itemsTimers).toEqual({ "2": 30 });
    expect(h.state.settings.itemsTimers).toEqual({ "2": 30 });
  });
});
