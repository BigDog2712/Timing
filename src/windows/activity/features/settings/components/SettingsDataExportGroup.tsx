import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietButton from "../../../shared/components/QuietButton";
import SettingsFullBundleExportRow from "./SettingsFullBundleExportRow";
import SettingsScheduledExportRow from "./SettingsScheduledExportRow";
import { ACTIVITY_ONLY_NOTE } from "./fullBundleCopy.ts";
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
        <SettingsPreferenceRow
          title={UI_TEXT.export.title}
          hint={`${UI_TEXT.export.subtitle}。${ACTIVITY_ONLY_NOTE}`}
        >
          <QuietButton size="compact" disabled={busy} onClick={onOpenDataExport}>
            {UI_TEXT.settings.dataExportAction}
          </QuietButton>
        </SettingsPreferenceRow>
        <SettingsPreferenceRow title={UI_TEXT.settings.dataImportAction}>
          <QuietButton size="compact" disabled={busy} onClick={onOpenDataImport}>
            {UI_TEXT.settings.dataImportAction}
          </QuietButton>
        </SettingsPreferenceRow>
        {/* [B5d] 「定时导出」原来埋在导出弹窗的头部图标里（四级深度），现在与另外三行并排。
            为什么放这组而不是 `s-sync`：定时导出与导出/导入/完整数据包是同一个主体
            —— 「活动库的进出」；`s-sync` 管的是「计时记录 ↔ Markdown 同步」，另一件事。
            放在「数据导入」之后、完整数据包之前：顺序按「单次动作 → 定时动作 → 全量动作」，
            用户从上往下读就是"导一次 / 定时导 / 全量导"。 */}
        <SettingsScheduledExportRow disabled={busy} />
        {/* [批 2] 全额数据包：事项 + 计时 + 便利贴 + 待办 + 应用活动 + 手机端数据，一个 JSON。 */}
        <SettingsFullBundleExportRow disabled={busy} />
      </QuietActionRow>
    </SettingsPreferenceGroup>
  );
}
