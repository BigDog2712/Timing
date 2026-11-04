/**
 * Timing — 主题 store（运行时主题 + 四色；唯一持有 resolved 主题的 store）
 * -----------------------------------------------------------------------------
 * 数据来源：theme_get / accent_get / theme_set / accent_set（Rust 命令）+ theme-changed 事件。
 * 状态变更后统一经 lib/theme 写入 <html data-theme> 与 --color-*（无 JS 重排）。
 */
import { create } from 'zustand';
import {
  applyAccents,
  applyTheme,
  readCachedTheme,
  resolveTheme,
  writeCachedTheme,
  DEFAULT_ACCENTS,
  type ResolvedTheme,
} from '../lib/theme';
import type { AccentColors, ThemeMode } from '../types/domain';

interface ThemeStore {
  /** 用户选择的模式（dark | light | system） */
  mode: ThemeMode;
  /** 解析后的实际主题（system 已解析为 dark/light） */
  resolved: ResolvedTheme;
  /** 四色（bar 允许 null = 跟随主题令牌） */
  accents: AccentColors;
  /** 是否已从后端读回权威值 */
  loaded: boolean;
  /** 应用一组主题+四色到 DOM 并更新状态（不落库；落库由 themeActions 负责） */
  apply: (mode: ThemeMode, accents: AccentColors) => void;
  /** 仅更新模式（ThemePicker 即时预览用） */
  setLocalMode: (mode: ThemeMode) => void;
  /** 仅更新四色（ThemePicker 即时预览用） */
  setLocalAccents: (accents: AccentColors) => void;
  markLoaded: () => void;
}

const initialMode = readCachedTheme();

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: initialMode,
  resolved: resolveTheme(initialMode),
  accents: DEFAULT_ACCENTS,
  loaded: false,

  apply: (mode, accents) => {
    const resolved = applyTheme(mode);
    applyAccents(accents, resolved);
    writeCachedTheme(mode);
    set({ mode, resolved, accents });
  },
  setLocalMode: (mode) => {
    const resolved = applyTheme(mode);
    applyAccents(get().accents, resolved);
    set({ mode, resolved });
  },
  setLocalAccents: (accents) => {
    applyAccents(accents, get().resolved);
    set({ accents });
  },
  markLoaded: () => set({ loaded: true }),
}));
