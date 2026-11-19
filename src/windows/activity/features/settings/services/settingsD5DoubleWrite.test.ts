/**
 * [B5c] D5 双写的**通路判据**（不是"点了有反应"，而是"写进了哪一行、广播了没有"）
 * -----------------------------------------------------------------------------
 * 背景（见 `SettingsResidentPanel` 头注）：同一件事原来有两个开关、两份持久化、同一个 OS 状态：
 *   (a) 通用卡「开机自启」→ `set_autostart`（写注册表 + 回写 `autostart_enabled`）；
 *   (b) 常驻卡「开机自启动」→ 草稿 `launchAtLogin` → 保存时 `cmd_commit_app_settings`。
 * B5c 只留 (a)，但它必须**双写**：`AppSettings.launchAtLogin` 也要跟着变成同一个值，
 * 否则 `useDesktopLaunchBehaviorSync` 会用旧值把 OS 状态翻回去。
 *
 * 这份文件钉的是双写用的**既有通路**（不许为此新造命令）：
 *   1. `commitSettingsPatch` = `persistPatch`（`cmd_commit_app_settings`）+ `notifySettingsChanged`
 *      （`app-settings-changed`）两段，一段落库、一段广播；
 *   2. `launchAtLogin` 落到的是 `launch_at_login` 这一行 —— 与 `useWindowTracking` 读回来的
 *      是同一行（否则"写了一份、读的是另一份"，比不写更糟）；
 *   3. 补丁只带被改的那一个键。
 *
 * 面板侧（谁在什么时候调它、入参是不是布尔、失败会不会亮红字）在
 * `components/host/HostGeneralPanel.test.tsx` 的 g09/g10/g11；「广播之后不会再回弹」在
 * `shell/hooks/useDesktopLaunchBehaviorSync.test.tsx`。
 */
import { describe, expect, it, vi } from 'vitest';

import { commitSettingsPatchWithDeps } from './settingsRuntimeAdapterService';
import {
  buildAppSettingMutations,
  buildRawAppSettingsPatch,
} from '../../../platform/persistence/appSettingsStore';

function fakeDeps() {
  return {
    persistPatch: vi.fn(async (_patch: unknown) => undefined),
    syncTimelineMergeGap: vi.fn(async (_seconds: number) => undefined),
    notifySettingsChanged: vi.fn(async (_patch: unknown) => undefined),
  };
}

describe('[B5c] D5 · 双写走现有回路', () => {
  it('d501_one_commit_persists_the_patch_and_broadcasts_the_same_patch', async () => {
    const deps = fakeDeps();
    const result = await commitSettingsPatchWithDeps({ launchAtLogin: true }, deps);

    /* 一段落库（`cmd_commit_app_settings`）、一段广播（`app-settings-changed`）——
       广播是「同一行被写掉了」的通知，不是"另一份真源"。 */
    expect(deps.persistPatch).toHaveBeenCalledTimes(1);
    expect(deps.persistPatch).toHaveBeenCalledWith({ launchAtLogin: true });
    expect(deps.notifySettingsChanged).toHaveBeenCalledTimes(1);
    expect(deps.notifySettingsChanged).toHaveBeenCalledWith({ launchAtLogin: true });
    /* 顺序：先落库、后广播（反了就是"界面先信了、库还没写"） */
    expect(deps.persistPatch.mock.invocationCallOrder[0])
      .toBeLessThan(deps.notifySettingsChanged.mock.invocationCallOrder[0]);
    /* 与时间轴合并间隔无关的补丁不该顺手去同步那套运行时 */
    expect(deps.syncTimelineMergeGap).not.toHaveBeenCalled();
    expect(result.runtimeSync).toBe('not-needed');
  });

  it('d502_launch_at_login_is_the_row_the_shell_reads_back', () => {
    /* 键名映射是双写的"同一行"保证：写的是 `launch_at_login`，`useWindowTracking`
       刷新时读的也是它。映射漂了，两份持久化会在同一个字段名上分叉。 */
    expect(buildRawAppSettingsPatch({ launchAtLogin: true })).toEqual({ launch_at_login: true });
    expect(buildRawAppSettingsPatch({ launchAtLogin: false })).toEqual({ launch_at_login: false });
    /* 真正过 IPC 的形状：`{ key, value }`，布尔序列化成 '1' / '0' */
    expect(buildAppSettingMutations(buildRawAppSettingsPatch({ launchAtLogin: true })))
      .toEqual([{ key: 'launch_at_login', value: '1' }]);
    expect(buildAppSettingMutations(buildRawAppSettingsPatch({ launchAtLogin: false })))
      .toEqual([{ key: 'launch_at_login', value: '0' }]);
  });

  it('d503_the_patch_carries_only_the_autostart_field', async () => {
    /* 双写是"顺手补一份同值"，不是"把整份 AppSettings 重刷一遍"：多带一个键就会
       把用户在别处改的、还没保存的偏好一起写掉。 */
    const deps = fakeDeps();
    await commitSettingsPatchWithDeps({ launchAtLogin: false }, deps);
    const patch = deps.persistPatch.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['launchAtLogin']);
  });
});
