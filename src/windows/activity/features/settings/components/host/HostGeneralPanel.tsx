/**
 * Timing — 设置 · 「通用与启动」组的 `s-general` 卡（settings-panel.md §3.1「通用」）
 * -----------------------------------------------------------------------------
 * 行骨架统一「左标签 + 右控件」（全页一条竖向对齐轴）。
 *
 * **[B5d] 这张卡现在只剩一行「开机自启」。** 「最短记录时长」已做**行级搬迁**到
 * `SettingsTrackingPanel` 的「计时规则」组（与合并间隔 / 空闲超时同组）—— 那一行决定
 * 记录粒度、属"计时行为"，和它的两个同族项待在一起才合理。搬迁是行级的：
 * 锚点 `s-general` 仍在、锚点总数仍 12、导航阶梯（`TOP_LADDER`）不用动。
 * 剩下的「开机自启」属**启动**语义，组名「通用与启动」仍贴题，**不要**为一行去合并或改名。
 *
 * [B5c] 「开机自启」是**唯一入口**（「常驻与启动」卡里那个写草稿的同义开关已移除，
 * 理由见 `SettingsResidentPanel` 头注），并且它一改就**双写**两份持久化 ——
 * 见下面开关 `onChange` 的注释。
 * 「倒计时到点自动结束并保存」开关已删除——到点恒为保存（用户设了目标就该落一条记录）。
 * 显示类设置（文字 / 背景不透明度、高亮颜色）在「外观配色」页签；
 * 「保持窗口置顶」「感知壁纸自动提高不透明度」「全局快捷键」三块见 ADR-022。
 *
 * 最短记录时长那一行的实现细节（为什么是数字框、为什么不缀说明、钳制与提交规矩）
 * 见 `SettingsMinRecordRow` 的头注。
 */
import { useEffect, useState } from 'react';
import { errorText, settingsApi } from '../../services/hostApi';
import { useSettingsStore } from '../../services/host/settingsRuntimeStore';
import { SettingsRuntimeAdapterService } from '../../services/settingsRuntimeAdapterService';
import QuietSwitch from '../../../../shared/components/QuietSwitch';

interface HostGeneralPanelProps {
  /**
   * 是否显示「开机自启」。移动端传 false（PRD §5 D4：Android 无等价语义，
   * 后端 get_settings 恒返回 false，留一个点了没反应的开关等于骗人）。
   * 桌面不传 = true，行为与样式完全不变。
   */
  showAutostart?: boolean;
}

export function HostGeneralPanel({ showAutostart = true }: HostGeneralPanelProps) {
  const settings = useSettingsStore((s) => s.settings);
  const [error, setError] = useState<string | null>(null);

  /* 首帧：设置拉一次（本窗的 store 是空的，宿主那边不会替我们填）。
     参考设置不在这里读了 —— 唯一的消费者「最短记录时长」已搬到 `SettingsMinRecordRow`。 */
  useEffect(() => {
    if (!settings) void useSettingsStore.getState().reload().catch(() => undefined);
  }, [settings]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="setting-group">
      {showAutostart && (
        <div className="setting-row">
          <span className="setting-row__label">开机自启</span>
          <QuietSwitch
            ariaLabel="开机自启"
            checked={settings?.autostartEnabled ?? false}
            onChange={(v) => void run(async () => {
              /* [B5c] D5：这一行现在是「开机自启」的**唯一入口**（「常驻与启动」卡里那个
                 写草稿的开关已移除）。它是即改即存，两条写必须同时落：
                   ① `set_autostart` → 写注册表 + 回写宿主设置的 `autostart_enabled`；
                   ② 同一份值再写进 `AppSettings.launchAtLogin`（`cmd_commit_app_settings`，
                      走 `commitSettingsPatch` = 落库 + 广播 `app-settings-changed`）。
                 只做①的话两份持久化会分叉：`useDesktopLaunchBehaviorSync` 监听
                 `appSettings.launchAtLogin`，下次它因任何依赖变化重跑时会把**旧值**打到 OS，
                 把用户刚关掉的自启又打开（出厂值就是 true）。所以②不是顺手，是必需。 */
              await settingsApi.setAutostart(v);
              await useSettingsStore.getState().reload();
              await SettingsRuntimeAdapterService.commitSettingsPatch({ launchAtLogin: v });
            })}
          />
        </div>
      )}

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
