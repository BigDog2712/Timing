/**
 * TickBar — 设置 store
 * -----------------------------------------------------------------------------
 * 数据来源：get_settings / update_settings / set_autostart（均为 Rust 侧命令）。
 * 默认值与后端 `Settings::default()` 一致。V0.3.3 起 `alwaysOnTop` /
 * `opacityEnabled` / `shortcuts` 三个字段随功能下架（ADR-022）；
 * V0.3.4 删 `countdownAutoEnd`——倒计时到点恒保存（ADR-023）。
 */
import { create } from 'zustand';
import { settingsApi } from '../services/api';
import { DEFAULT_MOYU_PRESETS, RECENT_ITEMS_DEFAULT } from '../lib/moyu';
import { DEFAULT_COUNTDOWN_PRESETS } from '../types/domain';
import type { ReferenceSettings, Settings } from '../types/domain';

export const DEFAULT_SETTINGS: Settings = {
  autostartEnabled: false,
  lastDisplayId: null,
  /* [V0.2.0] 默认值见 ARCHITECTURE-V0.2.0 §5.4 / schema-V0.2.0.sql */
  themeMode: 'dark',
  accents: { running: '#4DA3E8', warn: '#E8A33D', done: '#4CC38A', bar: null },
  countdownPresets: [...DEFAULT_COUNTDOWN_PRESETS],
  /* [V0.3.9] 常用摸鱼 / 常用事项框偏好（与 Rust `Settings::default()` 同值） */
  moyuPresets: [...DEFAULT_MOYU_PRESETS],
  itemsShowRecent: true,
  itemsRecentCount: RECENT_ITEMS_DEFAULT,
  itemsTimers: {},
};

interface SettingsStore {
  settings: Settings;
  referenceSettings: ReferenceSettings | null;
  loaded: boolean;
  setSettings: (settings: Settings) => void;
  setReferenceSettings: (settings: ReferenceSettings) => void;
  reloadReference: () => Promise<ReferenceSettings>;
  reload: () => Promise<Settings>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  referenceSettings: null,
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  setReferenceSettings: (referenceSettings) => set({ referenceSettings }),
  reloadReference: async () => {
    const referenceSettings = await settingsApi.getReference();
    set({ referenceSettings });
    return referenceSettings;
  },
  reload: async () => {
    const settings = await settingsApi.get();
    set({ settings, loaded: true });
    return settings;
  },
}));
