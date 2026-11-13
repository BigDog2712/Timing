import { useCallback, useState } from "react";
import type { AppLanguage } from "../shared/settings/appSettings.ts";
import { LocaleProvider } from "../shared/i18n/index.ts";
import { AppErrorBoundary } from "../../shared/AppErrorBoundary.tsx";
import UpdateDialogProvider from "./providers/UpdateDialogProvider.tsx";
import AppShellContent from "./AppShell.tsx";
import { APP_BOUNDARY_COPY } from "./components/appBoundaryCopy.ts";
import { useAppWindowState } from "./hooks/useAppWindowState.ts";
import { useMainWindowSizeMemory } from "./hooks/useMainWindowSizeMemory.ts";
import { useWindowTracking } from "./hooks/useWindowTracking.ts";

export default function AppShellLocaleRoot() {
  /* 窗口大小记忆挂在**根**上：它属于这扇窗，不属于某个视图；挂进 AppShellContent 会
   * 在切视图时被卸载重挂（每次都重新 restore 一遍，窗会跳） */
  useMainWindowSizeMemory();
  const appWindowState = useAppWindowState();
  const windowTracking = useWindowTracking({
    trackerHealthPollingEnabled: appWindowState.isForegroundReady,
  });
  const [settingsLanguagePreview, setSettingsLanguagePreview] = useState<AppLanguage | null>(null);
  const locale = settingsLanguagePreview ?? windowTracking.appSettings.language;
  const handleLocaleLoadError = useCallback((failedLocale: AppLanguage) => {
    setSettingsLanguagePreview((current) => current === failedLocale ? null : current);
  }, []);

  return (
    <LocaleProvider locale={locale} onLocaleLoadError={handleLocaleLoadError}>
      {/* [0.13 · 1.2] 最外层兜底（最后一道）：`AppShell` 自身崩了（某个 hook 抛错）时
          仍然留住一扇能点的窗，而不是 `#root` 空白 + WebView 深色底。
          视图级的细粒度边界在 `AppViewOutlet` 里，那一层不会带走标题栏。 */}
      <AppErrorBoundary copy={APP_BOUNDARY_COPY[locale]}>
        <UpdateDialogProvider>
          <AppShellContent
            appWindowState={appWindowState}
            setSettingsLanguagePreview={setSettingsLanguagePreview}
            windowTracking={windowTracking}
          />
        </UpdateDialogProvider>
      </AppErrorBoundary>
    </LocaleProvider>
  );
}
