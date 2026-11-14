import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietButton from "../../../shared/components/QuietButton";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

/**
 * 「存储」卡 · 第一组：导出与导入（[本轮] 统一到 `SettingsPreferenceGroup` + `SettingsPreferenceRow`）。
 *
 * 为什么统一：另外四组早就是这个形状（组标题 + 行标题 + 可选 hint 走 `QuietTooltip` +
 * 右侧 `settings-preference-control`），只有数据这组自己排 `flex items-center
 * justify-between` 的裸按钮行（`settings-data-action-*` 那一族）。两种行摆在同一页里，
 * 字重、行距、分隔线全对不上 —— 用户看到的就是「数据管理这块 UI 太差」。
 *
 * 行为零改动：两个回调与 `busy` 禁用态原样传下去；按钮从 `regular` 收到 `compact`，
 * 与本页其它组的行内控件同一档（`SettingsBoardPanel` / `SettingsTrackingPanel`）。
 * 行标题用 `export.title`（「数据导出」），hint 用它自带的 `export.subtitle` ——
 * 那句原本只出现在导出对话框里，正是「这一行是干什么的」。
 */
export default function SettingsDataExportGroup({
  busy,
  onOpenDataExport,
  onOpenDataImport,
}: {
  busy: boolean;
  onOpenDataExport: () => void;
  onOpenDataImport: () => void;
}) {
  const UI_TEXT = useLocaleText();
  return (
    <SettingsPreferenceGroup title={UI_TEXT.settings.dataExportTitle}>
      <QuietActionRow className="settings-preference-list">
        <SettingsPreferenceRow title={UI_TEXT.export.title} hint={UI_TEXT.export.subtitle}>
          <QuietButton size="compact" disabled={busy} onClick={onOpenDataExport}>
            {UI_TEXT.settings.dataExportAction}
          </QuietButton>
        </SettingsPreferenceRow>
        <SettingsPreferenceRow title={UI_TEXT.settings.dataImportAction}>
          <QuietButton size="compact" disabled={busy} onClick={onOpenDataImport}>
            {UI_TEXT.settings.dataImportAction}
          </QuietButton>
        </SettingsPreferenceRow>
      </QuietActionRow>
    </SettingsPreferenceGroup>
  );
}
