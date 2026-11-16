import type { AppLanguage, AppSettings, ColorScheme, ThemeMode } from "../../shared/settings/appSettings";
import type { QuietToastTone } from "../../shared/types/toast";
import type { ImportCategoryCandidate } from "../../platform/persistence/importRuntimeGateway.ts";
import type { PreparedImportClassification } from "./services/settingsImportService.ts";

export interface ColorSchemePreview {
  light: ColorScheme;
  dark: ColorScheme;
}

export interface SettingsPageProps {
  onSettingsChanged: (settings: AppSettings) => void;
  onColorSchemeSaved?: (settings: AppSettings) => void;
  /* [O3 2026-11-16] 这里原有 8 个更新相关 prop，来源是 `AboutPanel` 的同一个上下文。
     更新通道整批删除后，设置页不再承载任何「检查更新」入口（关于页也只留版本号与三个链接）。 */
  onDirtyChange?: (dirty: boolean) => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onThemeModePreview?: (themeMode: ThemeMode | null) => void;
  onColorSchemePreview?: (colorScheme: ColorSchemePreview | null) => void;
  onLanguagePreview?: (language: AppLanguage | null) => void;
  onPrepareImportCategories?: (
    candidates: readonly ImportCategoryCandidate[],
  ) => Promise<PreparedImportClassification>;
  onImportedDataChanged?: () => void;
}

export type CleanupRange = 180 | 90 | 60 | 30 | 15 | 7;
