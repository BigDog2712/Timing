/**
 * M-12 · 单槽闸的两半（施工单 §5.3 / §8 M-12；V-9 / V-10 的靶子）
 * -----------------------------------------------------------------------------
 * **两半都要断言**（只断一半都会漏一种失效）：
 *   · 只有"未置真时被丢弃"会漏——闸永久关死（migrate 从不成功）时它照样绿；
 *   · 只有"置真后能写"会漏——闸根本没生效（save 直接落盘）时它照样绿。
 *
 * 闸旗是模块局部 `timelineMigrationDone`，没有导出（导出 setter 就给了绕闸的后门），
 * 所以每条用例 `vi.resetModules()` + 动态 import 拿一份全新的模块状态。
 * `invoke` 在模块加载前就被 vi.mock 换掉，`vi.resetModules()` 不会还原它。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activityLegacyKeyOf } from '../../../shared/activityStorageKeys';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

/** 每条用例一份新模块（闸旗不可重置，也不许导出 setter）。 */
async function freshStore() {
  vi.resetModules();
  return import('./activityDisplaySettingsStore.ts');
}

/** 后端桩：设置表为空（迁移窗口的真实起点），迁移命令返回 'app'。 */
function stubBackend(overrides: Partial<Record<string, unknown>> = {}) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command in overrides) {
      const value = overrides[command];
      if (value instanceof Error) throw value;
      return value;
    }
    if (command === 'cmd_get_setting_rows') return [];
    if (command === 'cmd_migrate_history_timeline_mode') return 'app';
    return null;
  });
}

function commitCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([command]) => command === 'cmd_commit_app_settings');
}

describe('M-12 · 单槽闸', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it('两半：闸未开 ⇒ save 丢弃（后端未写 + debug 日志）；migrate 成功后同一调用正常落盘', async () => {
    stubBackend();
    localStorage.setItem(activityLegacyKeyOf('historyTimelineMode'), 'web');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const store = await freshStore();

      /* 前半：迁移闸未开 ⇒ 丢弃，cmd_commit_app_settings 不被调用，且有一条 debug。 */
      await store.saveActivityTimelineMode('category');
      expect(commitCalls()).toHaveLength(0);
      expect(debugSpy).toHaveBeenCalledWith('[timelineMode] migration pending, save dropped');

      /* bootstrap 的 await migrateActivityTimelineMode() 返回 ⇒ 闸开。 */
      const migrated = await store.migrateActivityTimelineMode();
      expect(migrated).toBe('app');

      /* 后半：同一调用正常落盘——证明闸不是永久关死。 */
      await store.saveActivityTimelineMode('category');
      const calls = commitCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({
        mutations: [{ key: 'history_timeline_mode', value: 'category' }],
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('migrate 抛出 ⇒ 闸仍关（置真不在 finally），save 继续丢弃', async () => {
    stubBackend({ cmd_migrate_history_timeline_mode: new Error('backend boom') });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const store = await freshStore();

      await expect(store.migrateActivityTimelineMode()).rejects.toThrow('backend boom');

      await store.saveActivityTimelineMode('app');
      expect(commitCalls()).toHaveLength(0);
      expect(debugSpy).toHaveBeenCalledWith('[timelineMode] migration pending, save dropped');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('后端已有值（existing !== null）⇒ 闸同样打开，save 落盘', async () => {
    stubBackend({ cmd_get_setting_rows: [{ key: 'history_timeline_mode', value: 'web' }] });
    const store = await freshStore();

    const migrated = await store.migrateActivityTimelineMode();
    expect(migrated).toBe('web');

    await store.saveActivityTimelineMode('app');
    const calls = commitCalls();
    expect(calls).toHaveLength(1);
  });
});
