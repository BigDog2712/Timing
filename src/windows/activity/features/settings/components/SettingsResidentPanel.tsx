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
 * 「常驻与启动」卡（[B5c] D5 去重后 · [B5c 补] 两组并为「运行行为」一组）
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
 *
 * ## [B5c 补] 为什么并成一组叫「运行行为」
 *
 * 原来这三行分在「窗口行为」（两个托盘开关）与「运行行为」（静默启动）两组里，第二组
 * 只剩一行 —— 一个标题伞着一行，扫读时反而多了个假的分区感。并成一组后**留「运行行为」
 * 这个名字**而不是「窗口行为」：`closeToTray` / `showTrayIcon` 是窗口策略，`startMinimized`
 * 是**启动**策略，只有「运行行为」能伞住三者。这是本页自己立的原则：不为省一个标题而让
 * 名字与内容错位。
 *
 * 三条一起排时用**单列**（`settings-preference-list`，不带 `-pair`）：3 是奇数，两列会在
 * 第二行留半格空位；分隔线由 `.settings-preference-list > .settings-preference-row +
 * .settings-preference-row` 给，三行两段线，不新增样式。行序沿用既有 DOM 顺序
 * （关闭到后台最高频，不重排）。
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

      <div className="mt-5">
        <SettingsPreferenceGroup title={UI_TEXT.settings.runtimeBehaviorTitle}>
          <QuietActionRow className="settings-preference-list">
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
