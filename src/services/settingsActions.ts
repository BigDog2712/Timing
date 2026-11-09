/**
 * Timing — 设置动作（菜单与设置面板共用；唯一改造设置的口径）
 * -----------------------------------------------------------------------------
 * - setAutostart：写/删 HKCU Run，返回**实际生效状态**并回填（AC-21）。
 * - updateReferenceSettings：Timing v1.7.3 参考设置（高亮颜色 / 最短记录时长等）。
 * - openSettings：打开设置入口（Tauri→独立 392×660 单例设置窗；浏览器 dev→主窗内联兜底）。
 * 失败即抛 IpcError，由调用方决定提示/回滚。
 *
 * V0.3.3：`setAlwaysOnTop` / `setOpacityEnabled` 随对应设置项下架（窗口恒定置顶，
 * 感知壁纸开关删除，见 ADR-022）。
 * V0.3.4：`setCountdownAutoEnd` 随开关下架——倒计时到点恒结束并保存（ADR-023）。
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

  async updateReferenceSettings(patch: Parameters<typeof ipc.updateReferenceSettings>[0]['patch']): Promise<void> {
    const referenceSettings = await ipc.updateReferenceSettings({ patch });
    useSettingsStore.getState().setReferenceSettings(referenceSettings);
  },

  /**
   * 打开时间统计（Patina）窗口。[V0.12.0 融合]
   *
   * 放在动作层而不是组件里：L1 门禁不许 `src/components` 出现 `ipc.`（ADR-017）。
   * 窗的生命周期归 Patina 自己（最后可见 / 重建 / 就绪握手），这里只递一次 show 请求；
   * 它还没就绪时后端返回的成功也是「已请求」，用户点第二次就会出来。
   */
  async openPatina(): Promise<void> {
    await ipc.openPatinaWindow();
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
