/**
 * TickBar — 设置动作（菜单与设置面板共用；唯一改造设置的口径）
 * -----------------------------------------------------------------------------
 * - setAutostart：写/删 HKCU Run，返回**实际生效状态**并回填（AC-21）。
 * - setAlwaysOnTop：先应用到窗口，再持久化 settings.alwaysOnTop。
 * - setOpacityEnabled：更新设置（感知壁纸降级开关）。
 * - openSettings：打开设置入口（Tauri→独立 392×660 单例设置窗；浏览器 dev→主窗内联兜底）。
 * 失败即抛 IpcError，由调用方决定提示/回滚。
 */
import { ipc, isTauri } from './ipc';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';

export const settingsActions = {
  async setAutostart(enabled: boolean): Promise<boolean> {
    const actual = await ipc.setAutostart({ enabled });
    useSettingsStore.getState().setSettings({ ...useSettingsStore.getState().settings, autostartEnabled: actual });
    return actual;
  },

  async setAlwaysOnTop(enabled: boolean): Promise<void> {
    await ipc.setAlwaysOnTop({ enabled });
    const settings = await ipc.updateSettings({ patch: { alwaysOnTop: enabled } });
    useSettingsStore.getState().setSettings(settings);
  },

  async setOpacityEnabled(enabled: boolean): Promise<void> {
    const settings = await ipc.updateSettings({ patch: { opacityEnabled: enabled } });
    useSettingsStore.getState().setSettings(settings);
  },

  /** [批2 N-6] 倒计时到点「自动结束并保存」开关（默认关；countdown-menu.md §3.3） */
  async setCountdownAutoEnd(enabled: boolean): Promise<void> {
    const settings = await ipc.updateSettings({ patch: { countdownAutoEnd: enabled } });
    useSettingsStore.getState().setSettings(settings);
  },
};

/**
 * 打开设置：Tauri 下开 392×660 独立设置窗（后端单例，ADR-009 §2）；
 * 浏览器 dev 无多窗口能力 → 主窗内联兜底（App.tsx 保留 panel==='settings' 分支）；
 * 建窗失败（如 capabilities 未放行）同样回退内联，避免「点了没反应」的静默失败。
 */
export async function openSettings(): Promise<void> {
  if (isTauri()) {
    try {
      await ipc.openSettingsWindow();
      return;
    } catch {
      /* 建窗失败 → 回退内联，不吞掉用户的点击 */
    }
  }
  useUiStore.getState().openPanel('settings');
}
