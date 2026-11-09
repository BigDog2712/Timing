import { deriveTheme } from "../../shared/theme/deriveTheme.ts";
import { applyActivityDisplayTheme } from "../../shared/theme/activityDisplayTheme.ts";
import { getThemePreset } from "../../shared/theme/themePresets.ts";
import { useLayoutEffect } from "react";
import type { ColorScheme, ThemeMode } from "../../shared/settings/appSettings.ts";
import { useHostThemeMode } from "./useHostThemeMode.ts";

type EffectiveTheme = "light" | "dark";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function resolveEffectiveTheme(themeMode: ThemeMode, prefersDark: boolean): EffectiveTheme {
  if (themeMode === "dark") return "dark";
  if (themeMode === "system" && prefersDark) return "dark";
  return "light";
}

function applyDocumentTheme(themeMode: ThemeMode, effectiveTheme: EffectiveTheme, colorScheme: ColorScheme) {
  const root = document.documentElement;
  root.dataset.themeMode = themeMode;
  root.dataset.theme = effectiveTheme;
  root.dataset.colorScheme = colorScheme;
  const tokens = deriveTheme(effectiveTheme, colorScheme, null);
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
  root.dataset.themeContrast = String(getThemePreset(effectiveTheme, colorScheme).contrast);
  root.style.colorScheme = effectiveTheme;
  applyActivityDisplayTheme(effectiveTheme, tokens);
}

export function isDocumentThemeApplied(
  themeMode: ThemeMode,
  colorSchemeLight: ColorScheme,
  colorSchemeDark: ColorScheme,
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const prefersDark = typeof window.matchMedia === "function"
    && window.matchMedia(COLOR_SCHEME_QUERY).matches;
  const effectiveTheme = resolveEffectiveTheme(themeMode, prefersDark);
  const colorScheme = effectiveTheme === "dark" ? colorSchemeDark : colorSchemeLight;
  const root = document.documentElement;

  return root.dataset.themeMode === themeMode
    && root.dataset.theme === effectiveTheme
    && root.dataset.colorScheme === colorScheme
    && root.dataset.themeContrast === String(getThemePreset(effectiveTheme, colorScheme).contrast)
    && root.style.colorScheme === effectiveTheme;
}

/**
 * 把主题落到 DOM，并返回**实际生效**的模式。
 *
 * `themeMode` 现在只是回落值：融合后深/浅由宿主的 `theme_get` / `theme-changed` 决定
 * （见 `useHostThemeMode`）。返回值必须被就绪判据用上——`isDocumentThemeApplied` 拿
 * 本地模式去比 DOM 的话，一旦两边不一致，主窗会一直判定「没渲染好」而不显示
 * （历史坑：窗口能开、永远不 ready）。配色预设（`colorSchemeLight/Dark`）仍归 Patina
 * 自己，宿主的四色是另一套令牌，不通用。
 */
export function useAppThemeMode(
  themeMode: ThemeMode,
  colorSchemeLight: ColorScheme,
  colorSchemeDark: ColorScheme,
): ThemeMode {
  const appliedThemeMode = useHostThemeMode(themeMode);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      const dark = appliedThemeMode === "dark";
      applyDocumentTheme(
        appliedThemeMode,
        dark ? "dark" : "light",
        dark ? colorSchemeDark : colorSchemeLight,
      );
      return undefined;
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const syncTheme = () => {
      const effectiveTheme = resolveEffectiveTheme(appliedThemeMode, mediaQuery.matches);
      applyDocumentTheme(
        appliedThemeMode,
        effectiveTheme,
        effectiveTheme === "dark" ? colorSchemeDark : colorSchemeLight,
      );
    };

    syncTheme();

    if (appliedThemeMode !== "system") {
      return undefined;
    }

    mediaQuery.addEventListener("change", syncTheme);
    return () => {
      mediaQuery.removeEventListener("change", syncTheme);
    };
  }, [ colorSchemeDark, colorSchemeLight, appliedThemeMode]);

  return appliedThemeMode;
}
