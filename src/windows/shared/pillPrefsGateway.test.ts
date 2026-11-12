/**
 * 悬浮条偏好网关的**入参形状**（[0.12.1 归一]）
 * -----------------------------------------------------------------------------
 * 这一层最容易写错、且错了最难查的地方是 `update_settings` 的载荷：Rust 侧要的是
 * `patch.pill.{appearance|handles}`，而「patch.appearance」「pill: {…} 直接放顶层」
 * 这类写法**都能编译**（`Partial<Settings>` 是开放对象），后端只是静默忽略未知字段 ——
 * 表现就是「设置改了、库没变、界面还是好的」。所以 here 逐字断言整棵调用树。
 *
 * 第二件是错误口径：读一律不 throw（药丸启动不能因为读设置崩），写必须 throw（设置页红字）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(() => Promise.resolve()) }));

import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { DEFAULT_HANDLE_BINDINGS } from './handleCatalog';
import { PILL_PREFS_EVENT } from './pillAppearance';
import type { PillPrefs } from './pillAppearance';
import {
  loadPillPrefs,
  nudgePillPrefs,
  savePillPrefs,
  seedPillPrefsIfAbsent,
} from './pillPrefsGateway';

const invokeMock = vi.mocked(invoke);
const emitMock = vi.mocked(emit);

/** 让 `isTauriRuntime()` 为真（否则网关会走「非宿主 → 不写」分支） */
function enterTauri(): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

function prefs(): PillPrefs {
  return {
    appearance: { textOpacity: 0.5, bgOpacity: 0.5, floatForm: 'bar' },
    handles: DEFAULT_HANDLE_BINDINGS,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  emitMock.mockReset();
  enterTauri();
});

describe('pillPrefsGateway', () => {
  it('g1_save_appearance_sends_patch_pill_appearance', async () => {
    invokeMock.mockResolvedValue({} as never);
    const appearance = { textOpacity: 0.4, bgOpacity: 0.9, floatForm: 'dot' as const };

    await savePillPrefs({ appearance });

    /* 逐字断言：少一层 `pill`、或把 `appearance` 提到 patch 顶层，这里立刻红 */
    expect(invokeMock).toHaveBeenCalledWith('update_settings', {
      patch: { pill: { appearance } },
    });
  });

  it('g2_save_handles_sends_patch_pill_handles', async () => {
    invokeMock.mockResolvedValue({} as never);

    await savePillPrefs({ handles: DEFAULT_HANDLE_BINDINGS });

    expect(invokeMock).toHaveBeenCalledWith('update_settings', {
      patch: { pill: { handles: DEFAULT_HANDLE_BINDINGS } },
    });
  });

  it('g3_save_failure_throws_for_the_settings_page', async () => {
    invokeMock.mockRejectedValue(new Error('数据保存失败'));
    await expect(savePillPrefs({ appearance: prefs().appearance })).rejects.toThrow('数据保存失败');
  });

  it('g4_load_returns_null_instead_of_throwing', async () => {
    /* ① 库里没写过（迁移信号）→ null */
    invokeMock.mockResolvedValue({ pill: null } as never);
    await expect(loadPillPrefs()).resolves.toBeNull();

    /* ② 坏形状 → null（不 throw：药丸启动不能因为读设置崩） */
    invokeMock.mockResolvedValue({ pill: { appearance: { textOpacity: 0.5 } } } as never);
    await expect(loadPillPrefs()).resolves.toBeNull();

    /* ③ 命令不存在 / 非 Tauri → null */
    invokeMock.mockRejectedValue(new Error('command not found'));
    await expect(loadPillPrefs()).resolves.toBeNull();

    /* ④ 正常 → 归一化后的快照 */
    invokeMock.mockResolvedValue({ pill: prefs() } as never);
    await expect(loadPillPrefs()).resolves.toEqual(prefs());
  });

  it('g5_seed_writes_only_when_the_host_table_is_empty', async () => {
    /* 库里是 null → 写一次（用户 0.12.1 里调好的值只落在 localStorage） */
    invokeMock.mockResolvedValueOnce({ pill: null } as never);
    invokeMock.mockResolvedValueOnce({} as never);
    await seedPillPrefsIfAbsent(prefs());
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'update_settings', {
      patch: { pill: prefs() },
    });

    /* 库里已经有 → 只读不写（否则每次启动都会把库里的新值盖回本窗旧缓存） */
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ pill: prefs() } as never);
    await seedPillPrefsIfAbsent(prefs());
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_settings');
  });

  it('g6_nudge_is_a_payload_free_signal', async () => {
    nudgePillPrefs();
    expect(emitMock).toHaveBeenCalledWith(PILL_PREFS_EVENT);
    /* 无载荷：真源在库里，载荷只会让「谁是权威」再次变模糊 */
    expect(emitMock.mock.calls[0]).toHaveLength(1);
  });
});
