import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietButton from "../../../shared/components/QuietButton";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

/**
 * 「存储」卡 · 数据管理（清理缓存 / 清理历史记录）。
 *
 * [本轮] 这两件事原来是**图标键**藏在「缓存目录」「数据目录」那两行的末尾
 * （旧目录行的右侧控件簇里第 0 位），既没有说明也点不准 —— 「清理历史记录」
 * 会删掉一整段真实记录，它必须是一个**带说明的独立动作**，而不是目录行上的一个垃圾桶。
 * 所以本轮各自升成一行：`title` = 动作名，`hint` = 原来只在确认框里出现的那句影响面，
 * `children` = 触发确认框的按钮（确认、档位滑杆、二次确认全在原对话框里，行为零改动）。
 */
export default function SettingsDataCleanupGroup({
  busy,
  isCleaning,
  onOpenCacheClear,
  onOpenHistoryCleanup,
}: {
  busy: boolean;
  isCleaning: boolean;
  onOpenCacheClear: () => void;
  onOpenHistoryCleanup: () => void;
}) {
  const UI_TEXT = useLocaleText();
  const storageText = UI_TEXT.settings.storage;
  return (
    <SettingsPreferenceGroup title={UI_TEXT.settings.cleanup}>
      <QuietActionRow className="settings-preference-list">
        <SettingsPreferenceRow
          title={storageText.webviewCacheClearTitle}
          hint={storageText.webviewCacheClearConfirmDetail}
        >
          <QuietButton size="compact" disabled={busy} onClick={onOpenCacheClear}>
            {storageText.webviewCacheClearTitle}
          </QuietButton>
        </SettingsPreferenceRow>
        <SettingsPreferenceRow title={UI_TEXT.settings.cleanupTitle} hint={UI_TEXT.settings.cleanupHint}>
          <QuietButton
            size="compact"
            tone="danger"
            disabled={busy || isCleaning}
            busy={isCleaning}
            onClick={onOpenHistoryCleanup}
          >
            {isCleaning ? UI_TEXT.settings.cleanupRunning : UI_TEXT.settings.cleanupNow}
          </QuietButton>
        </SettingsPreferenceRow>
      </QuietActionRow>
    </SettingsPreferenceGroup>
  );
}
