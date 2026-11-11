/**
 * Timing — 设置动作（菜单与设置面板共用；唯一改造设置的口径）
 * -----------------------------------------------------------------------------
 * - setAutostart：写/删 HKCU Run，返回**实际生效状态**并回填（AC-21）。
 * - updateReferenceSettings：Timing v1.7.3 参考设置（高亮颜色 / 最短记录时长等）。
 * - openSettings：打开设置入口（[0.12.1] 落点是分析窗的 settings 视图，见下）。
 * 失败即抛 IpcError，由调用方决定提示/回滚。
 *
 * V0.3.3：`setAlwaysOnTop` / `setOpacityEnabled` 随对应设置项下架（窗口恒定置顶，
 * 感知壁纸开关删除，见 ADR-022）。
 * V0.3.4：`setCountdownAutoEnd` 随开关下架——倒计时到点恒结束并保存（ADR-023）。
 */
import { errorText, ipc } from './ipc';
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
 * 打开设置：[0.12.1] 独立设置窗已下线，这个入口现在只是 `openSettingsInPatina()` 的别名。
 *
 * 保留函数名是因为菜单 / 快捷键 / 桥接消息都在调它；实现只留一份，避免两条落点口径。
 * [0.12.1 T04b] `open_host_settings` 也改调这里（药丸内联设置面板已删，见
 * hostIntentBridge.ts）；Rust 侧 `window::open_settings_window` 同样是**别名** ——
 * 命令还在（契约 81 条冻结），但函数体委托给 `tools_navigation::open_settings`，
 * 不再按 `window_spec::SETTINGS` 建窗。两侧同一个落点，谁改都别改回建窗那条路。
 */
export async function openSettings(): Promise<void> {
  await openSettingsInPatina();
}

/**
 * [V0.12.1] 设置落点：把**分析窗**叫到前台并落到设置视图。
 *
 * 走 `open_patina_window` 的可选落点参数 —— 命令名与命令条数都不变，只是 `target` 多认
 * 一个布尔键（判序 `history > settings > overview`，见 Rust `PatinaOpenTarget::into_view`）。
 * 冷启动也成立：Rust 侧先写 pending 再 show，分析窗起来后自己 take。
 */
export async function openSettingsInPatina(): Promise<void> {
  try {
    await ipc.openPatinaWindow({ target: { settings: true } });
  } catch (err) {
    /* 与分析窗其它落点同口径（FUSION-ARCH-v1 §6.5）：窗没就绪不算错，
       只有 invoke 真的失败才提示 —— 用户手上有一个可重试的动作 */
    useUiStore
      .getState()
      .setNotice({ text: `没能打开设置，请再点一次。（${errorText(err)}）`, tone: 'danger' });
  }
}
