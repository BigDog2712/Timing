/**
 * TickBar — 主题动作（设置面板 / 托盘菜单共用；唯一落库口径）
 * -----------------------------------------------------------------------------
 * - init()：首帧读 theme_get + accent_get → 应用并标记 loaded。
 * - setMode(mode)：theme_set → 应用（写 <html data-theme> + 快取）。
 * - setAccent(patch)：**前端先拦非法 hex**（呼应后端 INVALID_COLOR）→ accent_set → 应用。
 * - resetAccents()：恢复四色默认（bar = null = 跟随主题令牌）。
 */
import { DEFAULT_ACCENTS, isValidHex, type AccentKey } from '../lib/theme';
import { useThemeStore } from '../stores/themeStore';
import { ipc, IpcError } from './ipc';
import type { AccentColors, ThemeMode } from '../types/domain';

/** 前端合法性校验：非法 hex → INVALID_COLOR（与后端同码）；bar 允许 null */
function assertAccentValue(value: string | null): void {
  if (value != null && !isValidHex(value)) {
    throw new IpcError('INVALID_COLOR', '颜色值不合法');
  }
}

export const themeActions = {
  async init(): Promise<void> {
    const [theme, accents] = await Promise.all([ipc.themeGet(), ipc.accentGet()]);
    useThemeStore.getState().apply(theme.mode, accents);
    useThemeStore.getState().markLoaded();
  },

  async setMode(mode: ThemeMode): Promise<ThemeMode> {
    const theme = await ipc.themeSet({ mode });
    useThemeStore.getState().apply(theme.mode, useThemeStore.getState().accents);
    return theme.mode;
  },

  async setAccent(key: AccentKey, value: string | null): Promise<AccentColors> {
    assertAccentValue(value);
    const patch: Partial<AccentColors> = {};
    if (key === 'bar') patch.bar = value;
    else patch[key] = value as string;
    const accents = await ipc.accentSet({ patch });
    useThemeStore.getState().apply(useThemeStore.getState().mode, accents);
    return accents;
  },

  async resetAccents(): Promise<AccentColors> {
    const accents = await ipc.accentSet({
      patch: { running: DEFAULT_ACCENTS.running, warn: DEFAULT_ACCENTS.warn, done: DEFAULT_ACCENTS.done, bar: null },
    });
    useThemeStore.getState().apply(useThemeStore.getState().mode, accents);
    return accents;
  },
};
