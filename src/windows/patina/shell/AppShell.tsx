import { useMainToolsNavigation, type HistoryDateRequest } from "./hooks/useMainToolsNavigation.ts";
import { useCallback, useState } from "react";
import { useLocale, useLocaleText } from "../shared/i18n/index.ts";
import AppTitleBar from "./components/AppTitleBar";
import AppTopNav from "./components/AppTopNav.tsx";
import TimingCapsule from "./components/TimingCapsule.tsx";
import AppViewOutlet from "./components/AppViewOutlet.tsx";
import type { View } from "./types/view";
import { buildAppShellViews } from "./components/AppShellViews.tsx";
import QuietToastStack from "../shared/components/QuietToastStack";
import type {
  AppLanguage,
  HourlyActivityChartMode,
  ThemeMode,
} from "../shared/settings/appSettings.ts";
import type { ColorSchemePreview } from "../features/settings/types.ts";
import { useDashboardStats } from "../features/dashboard/hooks/useDashboardStats";
import { useWindowTracking } from "./hooks/useWindowTracking";
import {
  INITIAL_READ_MODEL_REFRESH_STATE,
  resolveReadModelRefreshSignal,
} from "./services/readModelRefreshState.ts";
import {
  loadDashboardRuntimeSnapshot,
  getHistoryRuntimeSeedSnapshot,
  loadDataTrendRuntimeSnapshot,
  loadHistoryRuntimeSnapshot,
} from "./services/readModelRuntimeService";
import { useQuietDialogs } from "../shared/hooks/useQuietDialogs";
import { useAppShellNavigation } from "./hooks/useAppShellNavigation";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useAppShellUpdateEntry } from "./hooks/useAppShellUpdateEntry";
import { useMainWindowReady } from "./hooks/useMainWindowReady.ts";
import { useQuietMotionPreference } from "../shared/motion/useQuietMotionPreference.ts";
import { useImportClassificationCoordinator } from "./hooks/useImportClassificationCoordinator.ts";
import {
  saveHourlyActivityChartModeSetting,
  saveMinSessionSecsSetting,
} from "./services/appSettingsRuntimeService.ts";
import {
  preloadNavigationView,
  useAppShellRenderedView,
} from "./hooks/useAppShellRenderedView.ts";
import { useAppWindowState } from "./hooks/useAppWindowState.ts";
import { useAppShellRuntimeLifecycle } from "./hooks/useAppShellRuntimeLifecycle.ts";
import ToolAlertDialog from "../features/tools/components/ToolAlertDialog.tsx";
import {
  parseLocalDateKey,
  startOfLocalDay,
} from "../shared/lib/localDate.ts";

type WindowTrackingState = ReturnType<typeof useWindowTracking>;
type AppWindowState = ReturnType<typeof useAppWindowState>;

export default function AppShellContent({
  appWindowState,
  setSettingsLanguagePreview,
  windowTracking,
}: {
  appWindowState: AppWindowState;
  setSettingsLanguagePreview: (language: AppLanguage | null) => void;
  windowTracking: WindowTrackingState;
}) {
  const { confirm, dialogs } = useQuietDialogs();
  const { titleBarUpdateEntry, settingsUpdateEntry } = useAppShellUpdateEntry();
  const {
    currentView,
    prepareNavigate,
    handleNavigate,
    registerSettingsSaveHandler,
    registerMappingSaveHandler,
    setSettingsDirty,
    setMappingDirty,
  } = useAppShellNavigation({ confirm });
  const { toasts, pushToast } = useAppShellToasts();
  const [readModelRefreshState, setReadModelRefreshState] = useState(
    INITIAL_READ_MODEL_REFRESH_STATE,
  );
  const {
    prepareImportCategories,
    onImportedDataChanged: handleImportedDataChanged,
    onMappingOverridesChanged,
  } = useImportClassificationCoordinator(setReadModelRefreshState);
  const [settingsThemeModePreview, setSettingsThemeModePreview] = useState<ThemeMode | null>(null);
  const [settingsColorSchemePreview, setSettingsColorSchemePreview] =
    useState<ColorSchemePreview | null>(null);
  const [historyDateRequest, setHistoryDateRequest] = useState<HistoryDateRequest | null>(null);
  const viewPresentation = useAppShellRenderedView(currentView, appWindowState.isForegroundReady);
  const { presentedView } = viewPresentation;
  const {
    isForegroundReady,
    isWindowForegroundLike,
    isWindowMaximized,
  } = appWindowState;
  const {
    appSettings,
    appearanceResolved,
    classificationReady,
    setAppSettings,
    syncTick,
    trackerHealth,
  } = windowTracking;
  const uiTextLanguage = useLocale();
  const uiText = useLocaleText();
  const dynamicEffects = appSettings.dynamicEffects;
  const quietMotionMode = useQuietMotionPreference(dynamicEffects);

  const appFrameRef = useMainWindowReady({
    appSettings,
    contentReady: appearanceResolved && presentedView === currentView,
    themeModePreview: settingsThemeModePreview,
    colorSchemePreview: settingsColorSchemePreview,
  });
  const refreshSignal = resolveReadModelRefreshSignal(syncTick, readModelRefreshState);
  const { mappingVersion } = readModelRefreshState;
  const isDashboardRefreshEnabled = currentView === "dashboard" && isForegroundReady;
  const isHistoryRefreshEnabled = currentView === "history" && isForegroundReady;
  const isDataRefreshEnabled = currentView === "data" && isForegroundReady;
  const { dashboard, icons, readState: dashboardReadState } = useDashboardStats(
    appSettings.refreshIntervalSecs,
    refreshSignal,
    trackerHealth,
    loadDashboardRuntimeSnapshot,
    mappingVersion,
    classificationReady,
    isDashboardRefreshEnabled,
  );
  useAppShellRuntimeLifecycle({
    classificationReady,
    isDataRefreshEnabled,
    isDashboardRefreshEnabled,
    isForegroundReady,
    isHistoryRefreshEnabled,
    isWindowForegroundLike,
    mappingVersion,
    quietMotionMode,
    syncTick,
    uiTextLanguage,
  });

  /* 宿主药丸递来的落点（历史 / 设置 / 总览；工具落点已并入主界面） */
  useMainToolsNavigation({ navigate: handleNavigate, setHistoryDateRequest });

  const handleMinSessionSecsChange = useCallback((nextValue: number) => {
    setAppSettings((current) => ({
      ...current,
      minSessionSecs: nextValue,
    }));
    void saveMinSessionSecsSetting(nextValue).catch(console.warn);
  }, [setAppSettings]);

  const handleHourlyActivityChartModeChange = useCallback((nextValue: HourlyActivityChartMode) => {
    setAppSettings((current) => ({
      ...current,
      hourlyActivityChartMode: nextValue,
    }));
    void saveHourlyActivityChartModeSetting(nextValue).catch(console.warn);
  }, [setAppSettings]);

  const handleMappingOverridesChanged = (message = uiText.app.mappingUpdated) => {
    onMappingOverridesChanged();
    pushToast(message, "success");
  };

  const handleQuickActionError = (message: string) => {
    pushToast(message, "error");
  };

  const openHistoryForDate = useCallback(async (dateKey: string) => {
    const targetDate = parseLocalDateKey(dateKey);
    if (!targetDate || startOfLocalDay(targetDate) > startOfLocalDay(new Date())) {
      return;
    }

    const result = await handleNavigate("history");
    if (!result.navigated) return;

    setHistoryDateRequest((current) => ({
      dateKey,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, [handleNavigate]);

  const handleSidebarNavigate = useCallback(async (nextView: View) => {
    setHistoryDateRequest(null);
    preloadNavigationView(nextView, "intent");
    const result = await handleNavigate(nextView);
    return result.navigated;
  }, [handleNavigate]);

  const handleSidebarPreviewNavigate = useCallback((nextView: View) => {
    preloadNavigationView(nextView, "preview");
  }, []);
  return (
    <div
      ref={appFrameRef}
      data-qp-motion={quietMotionMode}
      className={["qp-app-frame", isWindowMaximized ? "qp-app-frame-maximized" : ""].filter(Boolean).join(" ")}
    >
      <AppTitleBar
        isMaximized={isWindowMaximized}
        timingStatusEntry={<TimingCapsule />}
        navigationSlot={<AppTopNav currentView={presentedView} onPrepareNavigate={prepareNavigate}
          onNavigate={handleSidebarNavigate} onPreviewNavigate={handleSidebarPreviewNavigate} />}
        {...titleBarUpdateEntry}
      />

      {/* 无 gap：本容器只有 AppViewOutlet 的 <main> 一个在流子元素，其余三个图层都是 fixed */}
      <div className="qp-shell flex-1 min-h-0 flex overflow-hidden">
        <QuietToastStack toasts={toasts} />
        {/* 活动提醒 / 旧定时提醒到点弹窗（工具页下线后这条投递链保留，Q4） */}
        <ToolAlertDialog />
        {dialogs}

        <AppViewOutlet
          {...viewPresentation.outletProps}
          uiText={uiText}
          /* [0.13 · 1.2] 视图级错误边界的出口：单页崩了还能一键回到主界面 */
          onBackHome={() => { void handleSidebarNavigate("dashboard"); }}
          /* [P0 · 0.12.1] 装配搬到 `components/AppShellViews.tsx`：这里只传状态与回调。 */
          views={buildAppShellViews({
            aboutUpdateEntry: settingsUpdateEntry,
            appSettings,
            dashboard,
            dashboardReadState,
            getHistorySeedSnapshot: getHistoryRuntimeSeedSnapshot,
            historyDateRequest,
            historyRefreshEnabled: isHistoryRefreshEnabled,
            icons,
            loadDataTrendSnapshot: loadDataTrendRuntimeSnapshot,
            loadHistorySnapshot: loadHistoryRuntimeSnapshot,
            locale: uiTextLanguage,
            mappingVersion,
            onDataContentReady: viewPresentation.onDataContentReady,
            onHistoryContentReady: viewPresentation.onHistoryContentReady,
            onHourlyActivityChartModeChange: handleHourlyActivityChartModeChange,
            onImportedDataChanged: handleImportedDataChanged,
            onMappingOverridesChanged,
            onMappingSaved: handleMappingOverridesChanged,
            onMinSessionSecsChange: handleMinSessionSecsChange,
            onOpenHistoryDate: openHistoryForDate,
            onNavigateView: (nextView: View) => {
              void handleSidebarNavigate(nextView);
            },
            onOpenMapping: () => {
              void handleSidebarNavigate("mapping");
            },
            onPrepareImportCategories: prepareImportCategories,
            onQuickActionError: handleQuickActionError,
            onToast: pushToast,
            refreshSignal,
            registerMappingSaveHandler,
            registerSettingsSaveHandler,
            setAppSettings,
            setColorSchemePreview: setSettingsColorSchemePreview,
            setLanguagePreview: setSettingsLanguagePreview,
            setMappingDirty,
            setSettingsDirty,
            themeModePreviewSetter: setSettingsThemeModePreview,
            trackerHealth,
            uiText,
          })}
        />
      </div>
    </div>
  );
}
