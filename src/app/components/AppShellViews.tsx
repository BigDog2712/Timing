/**
 * [P0 · 0.12.1] `AppShell.tsx` 的 views 映射与六个预加载入口搬到这里。
 *
 * 为什么搬：`AppShell.tsx` 已顶到 300 行冻结线（`scripts/size-allowlist.json` 记的是 374），
 * 而 P1 要在它里面接布局 store 与加卡入口 —— 一行都腾不出来。这里只做装配：
 * 视图 props 逐字搬运、零行为变更，改的是文件边界，不是渲染结果。
 *
 * 装配面刻意保持「一个 props 对象进、一个 views 对象出」：AppShell 只留状态与回调，
 * 视图的参数形状由本文件对着各视图自己的 `ComponentProps` 派生，避免第二处手写类型漂移。
 */
import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from "react";
import AboutView from "../../features/about/components/About.tsx";
import AppMappingView from "../../features/classification/components/AppMapping.tsx";
import DataView from "../../features/data/components/Data.tsx";
import Dashboard from "../../features/dashboard/components/Dashboard.tsx";
import HistoryView from "../../features/history/components/History.tsx";
import SettingsView from "../../features/settings/components/Settings.tsx";
import ToolsView from "../../features/tools/components/Tools.tsx";
import { clearDataBootstrapCache } from "../../features/data/services/dataCacheLifecycle.ts";
import type { ColorSchemePreview } from "../../features/settings/types.ts";
import type { ToolsOpenTarget } from "../../features/tools/types.ts";
import type {
  AppLanguage,
  AppSettings,
  ThemeMode,
} from "../../shared/settings/appSettings.ts";
import type { UiText } from "../../shared/i18n/index.ts";
import type { QuietToastTone } from "../../shared/types/toast.ts";
import type { TrackerHealthSnapshot } from "../../shared/types/tracking";
import { createPreloadableViewComponent } from "../services/viewChunkPreloadService.ts";
import type { View } from "../types/view";

const History = createPreloadableViewComponent<ComponentProps<typeof HistoryView>>("history");
const Data = createPreloadableViewComponent<ComponentProps<typeof DataView>>("data");
const Settings = createPreloadableViewComponent<ComponentProps<typeof SettingsView>>("settings");
const About = createPreloadableViewComponent<ComponentProps<typeof AboutView>>("about");
const AppMapping =
  createPreloadableViewComponent<ComponentProps<typeof AppMappingView>>("mapping");
const Tools = createPreloadableViewComponent<ComponentProps<typeof ToolsView>>("tools");

export interface AppShellViewsProps {
  appSettings: AppSettings;
  aboutUpdateEntry: Omit<ComponentProps<typeof AboutView>, "onToast">;
  dashboard: ComponentProps<typeof Dashboard>["dashboard"];
  dashboardReadState: ComponentProps<typeof Dashboard>["readState"];
  getHistorySeedSnapshot: ComponentProps<typeof HistoryView>["getHistorySeedSnapshot"];
  historyDateRequest: ComponentProps<typeof HistoryView>["selectedDateRequest"];
  historyRefreshEnabled: boolean;
  icons: ComponentProps<typeof Dashboard>["icons"];
  loadDataTrendSnapshot: ComponentProps<typeof DataView>["loadDataTrendSnapshot"];
  loadHistorySnapshot: ComponentProps<typeof HistoryView>["loadHistorySnapshot"];
  locale: AppLanguage;
  mappingVersion: number;
  onDataContentReady: () => void;
  onHistoryContentReady: () => void;
  onHourlyActivityChartModeChange: ComponentProps<typeof HistoryView>["onHourlyActivityChartModeChange"];
  onImportedDataChanged: ComponentProps<typeof SettingsView>["onImportedDataChanged"];
  onMappingOverridesChanged: () => void;
  onMappingSaved: (message?: string) => void;
  onMinSessionSecsChange: ComponentProps<typeof HistoryView>["onMinSessionSecsChange"];
  onOpenHistoryDate: (dateKey: string) => Promise<void>;
  onOpenMapping: () => void;
  onPrepareImportCategories: ComponentProps<typeof SettingsView>["onPrepareImportCategories"];
  onQuickActionError: (message: string) => void;
  onToast: (message: string, tone?: QuietToastTone) => void;
  onToolsInitialTargetConsumed: () => void;
  refreshSignal: number;
  registerMappingSaveHandler: ComponentProps<typeof AppMappingView>["onRegisterSaveHandler"];
  registerSettingsSaveHandler: ComponentProps<typeof SettingsView>["onRegisterSaveHandler"];
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  setColorSchemePreview: (preview: ColorSchemePreview | null) => void;
  setLanguagePreview: (language: AppLanguage | null) => void;
  setMappingDirty: (dirty: boolean) => void;
  setSettingsDirty: (dirty: boolean) => void;
  showToolNavigationLabels: boolean;
  themeModePreviewSetter: (mode: ThemeMode | null) => void;
  toolsInitialTarget: ToolsOpenTarget | null;
  trackerHealth: TrackerHealthSnapshot;
  uiText: UiText;
}

export function buildAppShellViews(props: AppShellViewsProps): Record<View, ReactNode> {
  const {
    aboutUpdateEntry,
    appSettings,
    dashboard,
    dashboardReadState,
    getHistorySeedSnapshot,
    historyDateRequest,
    historyRefreshEnabled,
    icons,
    loadDataTrendSnapshot,
    loadHistorySnapshot,
    locale,
    mappingVersion,
    onDataContentReady,
    onHistoryContentReady,
    onHourlyActivityChartModeChange,
    onImportedDataChanged,
    onMappingOverridesChanged,
    onMappingSaved,
    onMinSessionSecsChange,
    onOpenHistoryDate,
    onOpenMapping,
    onPrepareImportCategories,
    onQuickActionError,
    onToast,
    onToolsInitialTargetConsumed,
    refreshSignal,
    registerMappingSaveHandler,
    registerSettingsSaveHandler,
    setAppSettings,
    setColorSchemePreview,
    setLanguagePreview,
    setMappingDirty,
    setSettingsDirty,
    showToolNavigationLabels,
    themeModePreviewSetter,
    toolsInitialTarget,
    trackerHealth,
    uiText,
  } = props;

  /* 快捷分类回调：宿主历史页/数据页共用同两份出口，消息文案在各自调用点给。 */
  const quickClassificationCallbacks = {
    onOverridesChanged: () => onMappingSaved(uiText.common.saved),
    onQuickActionError,
  };

  return {
    dashboard: (
      <Dashboard
        dashboard={dashboard}
        icons={icons}
        readState={dashboardReadState}
        refreshKey={refreshSignal}
        onOpenMapping={onOpenMapping}
      />
    ),
    history: (
      <History
        onInitialContentReady={onHistoryContentReady}
        icons={icons}
        refreshKey={refreshSignal}
        refreshIntervalSecs={appSettings.refreshIntervalSecs}
        mergeThresholdSecs={appSettings.timelineMergeGapSecs}
        minSessionSecs={appSettings.minSessionSecs}
        onMinSessionSecsChange={onMinSessionSecsChange}
        trackerHealth={trackerHealth}
        mappingVersion={mappingVersion}
        getHistorySeedSnapshot={getHistorySeedSnapshot}
        loadHistorySnapshot={loadHistorySnapshot}
        selectedDateRequest={historyDateRequest}
        hourlyActivityChartMode={appSettings.hourlyActivityChartMode}
        onHourlyActivityChartModeChange={onHourlyActivityChartModeChange}
        refreshEnabled={historyRefreshEnabled}
        webActivityEnabled={appSettings.webActivityEnabled}
        uiText={uiText}
        locale={locale}
        {...quickClassificationCallbacks}
      />
    ),
    data: (
      <Data
        onInitialContentReady={onDataContentReady}
        icons={icons}
        refreshKey={refreshSignal}
        trackerHealth={trackerHealth}
        loadDataTrendSnapshot={loadDataTrendSnapshot}
        mappingVersion={mappingVersion}
        mergeThresholdSecs={appSettings.timelineMergeGapSecs}
        onOpenHistoryDate={(dateKey) => {
          void onOpenHistoryDate(dateKey);
        }}
        onToast={onToast}
        {...quickClassificationCallbacks}
        uiLanguage={locale}
        webActivityEnabled={appSettings.webActivityEnabled}
      />
    ),
    tools: (
      <Tools
        key="tools"
        initialTarget={toolsInitialTarget}
        onInitialTargetConsumed={onToolsInitialTargetConsumed}
        icons={icons}
        showNavigationLabels={showToolNavigationLabels}
        onToast={onToast}
      />
    ),
    settings: (
      <Settings
        key="settings"
        onSettingsChanged={(nextSettings: AppSettings) => {
          if (nextSettings.language !== appSettings.language) {
            void clearDataBootstrapCache();
          }
          setAppSettings(nextSettings);
          themeModePreviewSetter(null);
          setColorSchemePreview(null);
          setLanguagePreview(null);
        }}
        onColorSchemeSaved={(nextSettings: AppSettings) => {
          setAppSettings(nextSettings);
          setColorSchemePreview(null);
        }}
        onRegisterSaveHandler={registerSettingsSaveHandler}
        onDirtyChange={setSettingsDirty}
        onThemeModePreview={themeModePreviewSetter}
        onColorSchemePreview={setColorSchemePreview}
        onLanguagePreview={setLanguagePreview}
        onToast={onToast}
        onPrepareImportCategories={onPrepareImportCategories}
        onImportedDataChanged={onImportedDataChanged}
      />
    ),
    about: (
      <About
        key="about"
        {...aboutUpdateEntry}
        onToast={onToast}
      />
    ),
    mapping: (
      <AppMapping
        key="mapping"
        icons={icons}
        onRegisterSaveHandler={registerMappingSaveHandler}
        titleRecordingEnabled={appSettings.titleRecordingEnabled}
        onDirtyChange={setMappingDirty}
        onOverridesChanged={onMappingSaved}
        onSessionsDeleted={() => {
          onMappingOverridesChanged();
          onToast(uiText.mapping.objectDeleted, "success");
        }}
        webActivityEnabled={appSettings.webActivityEnabled}
      />
    ),
  };
}
