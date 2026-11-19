import { useLocaleText } from "../../../shared/i18n/index.ts";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { SettingsPageProps } from "../types";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import QuietPageToolbar from "../../../shell/components/QuietPageToolbar.tsx";
import QuietButton from "../../../shared/components/QuietButton";
import SettingsAppearancePanel from "./SettingsAppearancePanel";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import SettingsHeaderActions from "./SettingsHeaderActions";
import SettingsGroupNav from "./SettingsGroupNav";
import SettingsHandlesPanel from "./SettingsHandlesPanel";
import SettingsResidentPanel from "./SettingsResidentPanel";
import SettingsTrackingPanel from "./SettingsTrackingPanel";import { HostGeneralPanel } from "./host/HostGeneralPanel";
import HostHighlightCard from "./host/HostHighlightCard";
import HostPillLookCard from "./host/HostPillLookCard";
import { HostPluginsPanel } from "./host/HostPluginsPanel";
import HostAiCard from "./host/HostAiCard";
import { HostSyncPanel } from "./host/HostSyncPanel";
import HostThemeCard from "./host/HostThemeCard";
import { useSettingsPageState } from "../hooks/useSettingsPageState";
import { useSettingsImportState } from "../hooks/useSettingsImportState.ts";
import { prepareSettingsLanguagePreview } from "../services/settingsLanguagePreview.ts";

const SettingsDataExportDialog = lazy(() => import("./SettingsDataExportDialog.tsx"));
const SettingsDataImportDialog = lazy(() => import("./SettingsDataImportDialog.tsx"));

export default function Settings({
  onSettingsChanged,
  onColorSchemeSaved,
  onDirtyChange,
  onToast,
  onRegisterSaveHandler,
  onColorSchemePreview,
  onLanguagePreview,
  onPrepareImportCategories,
  onImportedDataChanged,
}: SettingsPageProps) {
  const UI_TEXT = useLocaleText();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [languageSelectionPending, setLanguageSelectionPending] = useState(false);
  const languageSelectionPendingRef = useRef(false);
  const languageSelectionRevisionRef = useRef(0);
  const registerSaveHandler = useCallback((handler: (() => Promise<boolean>) | null) => {
    onRegisterSaveHandler?.(handler
      ? async () => languageSelectionPendingRef.current ? false : handler()
      : null);
  }, [onRegisterSaveHandler]);
  const importState = useSettingsImportState(
    onToast,
    onPrepareImportCategories,
    onImportedDataChanged,
  );
  const {
    dialogs,
    loading,
    loadError,
    retryLoading,
    savedSettings,
    draftSettings,
    saveStatus,
    hasUnsavedChanges,
    handleCancel,
    handleSave,
    handleSaveColorScheme,
    handleChange,
    cleanupRange,
    setCleanupRange,
    isCleaning,
    handleCleanup,
    storageSnapshot,
    isStorageBusy,
    handleRefreshStorageSnapshot,
    handleScheduleWebviewCacheClear,
    handleChooseCacheDirectory,
    handleRestoreDefaultCacheDirectory,
    handleOpenStorageDirectory,
    idleTimeoutMinutes,
    timelineMergeGapMinutes,
    cleanupOptions,
    idleTimeoutMinutesRange,
    timelineMergeGapMinutesRange,
  } = useSettingsPageState({
    onSettingsChanged,
    onColorSchemeSaved,
    onDirtyChange,
    onToast,
    onRegisterSaveHandler: registerSaveHandler,
  });
  const handleLanguageChange = useCallback(async (nextLanguage: AppLanguage) => {
    if (languageSelectionPendingRef.current || draftSettings?.language === nextLanguage) return;
    const revision = ++languageSelectionRevisionRef.current;
    languageSelectionPendingRef.current = true;
    setLanguageSelectionPending(true);
    try {
      const result = await prepareSettingsLanguagePreview(nextLanguage);
      if (revision !== languageSelectionRevisionRef.current) return;
      if (result.ready) {
        handleChange("language", nextLanguage);
        return;
      }
      console.error(`[i18n] failed to prepare settings language ${nextLanguage}`, result.error);
      onToast?.(UI_TEXT.settings.languageLoadFailed, "error");
    } finally {
      if (revision === languageSelectionRevisionRef.current) {
        languageSelectionPendingRef.current = false;
        setLanguageSelectionPending(false);
      }
    }
  }, [draftSettings?.language, handleChange, onToast, UI_TEXT]);

  useEffect(() => {
    if (!draftSettings) return;
    onColorSchemePreview?.({
      light: draftSettings.colorSchemeLight,
      dark: draftSettings.colorSchemeDark,
    });
    onLanguagePreview?.(draftSettings.language);
  }, [draftSettings, onColorSchemePreview, onLanguagePreview]);

  useEffect(() => () => {
    languageSelectionRevisionRef.current += 1;
    languageSelectionPendingRef.current = false;
    onColorSchemePreview?.(null);
    onLanguagePreview?.(null);
  }, [onColorSchemePreview, onLanguagePreview]);

  if (loading || !savedSettings || !draftSettings) {
    return (
      <div className="flex h-full min-w-0 flex-col gap-4 md:gap-5">
        {/* [本轮 T05] 视觉页头下线，读屏的名字不丢 */}
        <h1 className="sr-only">{UI_TEXT.settings.title}</h1>
        <div className="at-panel flex flex-1 items-center justify-center gap-3 text-[var(--at-text-tertiary)]">
          <span className="at-text-body at-weight-medium">
            {loadError ? UI_TEXT.settings.loadFailed : UI_TEXT.settings.loading}
          </span>
          {loadError ? (
            <QuietButton size="regular" onClick={() => { void retryLoading(); }}>
              {UI_TEXT.settings.retry}
            </QuietButton>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    /* `relative`：工具条是绝对定位（`dashboard-r2.css` 的 `.at-page-toolbar`），锚点必须是本页根。 */
    <div className="settings-button-preview relative flex h-full w-full min-w-0 flex-col gap-4 md:gap-5">
      {dialogs}
      {/* [T05] 页头删了但保存/取消不能丢：搬进 `QuietPageToolbar`（仍是 QuietButton，size compact）。 */}
      <QuietPageToolbar ariaLabel={UI_TEXT.settings.title} modifier="at-settings-toolbar">
        <SettingsHeaderActions
          saveStatus={saveStatus}
          hasUnsavedChanges={hasUnsavedChanges}
          blocked={languageSelectionPending}
          onCancel={handleCancel}
          onSave={() => void handleSave()}
        />
      </QuietPageToolbar>
      <h1 className="sr-only">{UI_TEXT.settings.title}</h1>

      <SettingsGroupNav />

      <div className="flex-1 overflow-y-auto at-scroll-region pr-2" id="settings-scroll">
        {/* 网格顺序 = `settingsGroups.ts` 的五组顺序（按使用场景、高频组在前）：挪卡片必须
            同批改那张表，否则导航跳到空处 —— `settingsGroups.source.test` 的 DOM_ORDER 就钉这条。 */}
        <div className="grid grid-cols-1 gap-4 md:gap-5">
          {/* 第 1 组「计时行为」：调时长最先碰的就是这里，`timelineMergeGapSecs` 全应用只有这一处可编辑。 */}
          <div id="s-tracking">
            <SettingsTrackingPanel
              timelineMergeGapControl={{
                label: UI_TEXT.settings.timelineMergeGapLabel,
                hint: UI_TEXT.settings.timelineMergeGapHint,
                minutes: timelineMergeGapMinutes,
                minMinutes: timelineMergeGapMinutesRange.min,
                maxMinutes: timelineMergeGapMinutesRange.max,
                onMinutesChange: (nextMinutes) => handleChange("timelineMergeGapSecs", nextMinutes * 60),
              }}
              idleTimeoutControl={{
                label: UI_TEXT.settings.idleTimeoutLabel,
                hint: UI_TEXT.settings.idleTimeoutHint,
                minutes: idleTimeoutMinutes,
                minMinutes: idleTimeoutMinutesRange.min,
                maxMinutes: idleTimeoutMinutesRange.max,
                onMinutesChange: (nextMinutes) => handleChange("idleTimeoutSecs", nextMinutes * 60),
              }}
              trackingPaused={draftSettings.trackingPaused}
              onTrackingPausedChange={(nextChecked) => handleChange("trackingPaused", nextChecked)}
              titleRecordingEnabled={draftSettings.titleRecordingEnabled}
              onTitleRecordingEnabledChange={(nextChecked) => handleChange("titleRecordingEnabled", nextChecked)}
            />
          </div>

          {/* 第 2 组「外观与主题」：全应用可写主色的控件只剩 `HostThemeCard` 这一处。 */}
          <HostThemeCard id="s-theme" />
          <HostHighlightCard id="s-highlight" />
          <div id="s-display">
            <SettingsAppearancePanel
              language={draftSettings.language}
              onLanguageChange={(nextLanguage) => { void handleLanguageChange(nextLanguage); }}
              languageDisabled={languageSelectionPending}
              colorSchemeLight={draftSettings.colorSchemeLight}
              onColorSchemeLightChange={(nextColorScheme) => handleChange("colorSchemeLight", nextColorScheme)}
              colorSchemeDark={draftSettings.colorSchemeDark}
              onColorSchemeDarkChange={(nextColorScheme) => handleChange("colorSchemeDark", nextColorScheme)}
              dynamicEffects={draftSettings.dynamicEffects}
              onDynamicEffectsChange={(nextChecked) => handleChange("dynamicEffects", nextChecked)}
              onConfirmColorSchemeChange={handleSaveColorScheme}
              colorSchemeConfirming={saveStatus === "saving"}
            />
          </div>

          {/* 第 3 组「悬浮条与把手」：设置一次就不再动的项，降到第一屏之后（B5b 的口径见分组表）。 */}
          <SettingsHandlesPanel id="s-pill-handles" />
          <HostPillLookCard id="s-pill-look" />

          {/* 第 4 组「数据与同步」：宿主的 md_sync（计时记录）在前，活动库备份在后。 */}
          <div id="s-sync"><HostSyncPanel /></div>
          <div id="s-backup">
            <SettingsDataSafetyPanel
              cleanupRange={cleanupRange}
              cleanupOptions={cleanupOptions}
              isCleaning={isCleaning}
              onCleanupRangeChange={setCleanupRange}
              onCleanup={() => { void handleCleanup(); }}
              onOpenDataExport={() => setExportDialogOpen(true)}
              onOpenDataImport={() => void importState.openDialog()}
              isImportBusy={importState.busy}
              storageSnapshot={storageSnapshot}
              isStorageBusy={isStorageBusy}
              onRefreshStorageSnapshot={handleRefreshStorageSnapshot}
              onScheduleWebviewCacheClear={handleScheduleWebviewCacheClear}
              onChooseCacheDirectory={handleChooseCacheDirectory}
              onRestoreDefaultCacheDirectory={handleRestoreDefaultCacheDirectory}
              onOpenStorageDirectory={handleOpenStorageDirectory}
            />
          </div>
          {/* 第 5 组「通用与启动」：三张卡都直接写宿主设置，不走草稿/保存。 */}
          <div id="s-general"><HostGeneralPanel /></div>
          <div id="s-resident">
            <SettingsResidentPanel
              showTrayIconChecked={draftSettings.showTrayIcon}
              onShowTrayIconChange={(nextChecked) => handleChange("showTrayIcon", nextChecked)}
              closeToTrayChecked={draftSettings.closeBehavior === "tray"}
              onCloseToTrayChange={(nextChecked) => {
                handleChange(
                  "closeBehavior",
                  nextChecked ? "tray" : "exit",
                );
              }}
              startMinimizedChecked={draftSettings.startMinimized}
              onStartMinimizedChange={(nextChecked) => handleChange("startMinimized", nextChecked)}
            />
          </div>
          <div id="s-plugins"><HostPluginsPanel /></div>
          {/* [0.12.3] AI 卡放在「通用与启动」组末位：它是全局能力，不属于任一已有面板。 */}
          <div id="s-ai"><HostAiCard /></div>
        </div>
      </div>

      {exportDialogOpen ? (
        <Suspense fallback={null}>
          <SettingsDataExportDialog
            open
            onClose={() => setExportDialogOpen(false)}
            onToast={onToast}
          />
        </Suspense>
      ) : null}
      {importState.open ? (
        <Suspense fallback={null}>
          <SettingsDataImportDialog
            open
            view={importState.view}
            busy={importState.busy}
            preview={importState.preview}
            batches={importState.batches}
            onClose={importState.closeDialog}
            onChooseCanonicalCsv={() => void importState.chooseCanonicalCsv()}
            onConfirmImport={() => void importState.confirmImport()}
            onDestructureExternal={() => void importState.destructureExternal()}
            onShowBatches={importState.showBatches}
            onShowActions={importState.showActions}
            onRemoveBatch={(batchId) => void importState.removeBatch(batchId)}
            onImportedDataChanged={onImportedDataChanged}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
