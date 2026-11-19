import { useLocaleText } from "../../../shared/i18n/index.ts";
import { MonitorCog } from "lucide-react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";


type SettingsResidentPanelProps = {
  showTrayIconChecked: boolean;
  onShowTrayIconChange: (nextChecked: boolean) => void;
  closeToTrayChecked: boolean;
  onCloseToTrayChange: (nextChecked: boolean) => void;
  startMinimizedChecked: boolean;
  onStartMinimizedChange: (nextChecked: boolean) => void;
};

/**
 * 「常驻与启动」卡（[B5c] D5 去重后）
 * -----------------------------------------------------------------------------
 * **「开机自启动」这一行在这里被移除了**，不是漏了：同一件事原来有两个开关 ——
 *   (a) 本卡这一行 → 写草稿 `launchAtLogin` → 按保存才 `cmd_commit_app_settings`；
 *   (b) 「通用」卡的「开机自启」→ 即改即存 `set_autostart`（写注册表 + 回写 autostart_enabled）。
 * 两者打到**同一个 OS 状态**、持久化**两份**，还会互相覆盖（出厂 `launchAtLogin = true`，
 * 用户关掉 (b) 后，(b) 的 off 会被下一次启动时按 (a) 的 true 重新打开）。
 *
 * 保留的是 (b)：开机自启是系统级动作，需要即时反馈；草稿式开关用户不按保存就等于没设。
 * 现在由「通用」卡那一个开关**双写**两份持久化（见 `HostGeneralPanel` 的注释），
 * 本卡只留真正属于"常驻"的三件事：关闭到后台 / 显示托盘图标 / 静默启动。
 */
export default function SettingsResidentPanel({
  showTrayIconChecked,
  onShowTrayIconChange,
  closeToTrayChecked,
  onCloseToTrayChange,
  startMinimizedChecked,
  onStartMinimizedChange,
}: SettingsResidentPanelProps) {
  const UI_TEXT = useLocaleText();
  return (
    <section className="at-panel p-5 md:p-6">
      <SettingsPanelHeader
        icon={<MonitorCog size={16} className="text-[var(--at-accent-default)]" />}
        title={UI_TEXT.settings.residentTitle}
      />

      <div className="mt-5 space-y-5">
        <SettingsPreferenceGroup title={UI_TEXT.settings.windowBehaviorTitle}>
          <QuietActionRow className="settings-preference-list settings-preference-pair">
            <SettingsPreferenceRow title={UI_TEXT.settings.closeToTrayLabel}>
              <QuietSwitch
                checked={closeToTrayChecked}
                onChange={onCloseToTrayChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleCloseToTray}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.showTrayIconLabel}>
              <QuietSwitch
                checked={showTrayIconChecked}
                onChange={onShowTrayIconChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleShowTrayIcon}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
        <SettingsPreferenceGroup title={UI_TEXT.settings.runtimeBehaviorTitle}>
          {/* 只剩「静默启动」一行 → 去掉 `settings-preference-pair`：那条两列网格把竖分隔线
              画在 `:last-child` 的左侧，单行时会在组左缘留一道悬空竖线（数据卡的同款毛病
              在 `settings.css` 里是给成对行用的）。 */}
          <QuietActionRow className="settings-preference-list">
            <SettingsPreferenceRow title={UI_TEXT.settings.startMinimizedLabel}>
              <QuietSwitch
                checked={startMinimizedChecked}
                onChange={onStartMinimizedChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleStartMinimized}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
      </div>
    </section>
  );
}
