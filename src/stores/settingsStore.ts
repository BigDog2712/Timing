/**
 * TickBar — 设置 store
 * -----------------------------------------------------------------------------
 * 数据来源：get_settings / update_settings / set_autostart（均为 Rust 侧命令）。
 * 默认值与 IPC-CONTRACT-v2 §5.4 一致（shortcuts 四字段默认 null = 未注册，[P1]）。
 */
import { create } from 'zustand';
import { ipc } from '../services/ipc';
import { DEFAULT_COUNTDOWN_PRESETS } from '../types/domain';
import type { ReferenceSettings, Settings } from '../types/domain';

export const DEFAULT_SETTINGS: Settings = {
  autostartEnabled: false,
  alwaysOnTop: true,
  opacityEnabled: true,
  lastDisplayId: null,
  shortcuts: { toggleWindow: null, startPause: null, stop: null, newItem: null },
  /* [V0.2.0] 默认值见 ARCHITECTURE-V0.2.0 §5.4 / schema-V0.2.0.sql */
  themeMode: 'dark',
  accents: { running: '#4DA3E8', warn: '#E8A33D', done: '#4CC38A', bar: null },
  countdownPresets: [...DEFAULT_COUNTDOWN_PRESETS],
  /* [V0.2.0 批2] 倒计时到点「自动结束并保存」开关：默认关（仅通知 + 视觉提示，AC-62） */
  countdownAutoEnd: false,
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
    const referenceSettings = await ipc.getReferenceSettings();
    set({ referenceSettings });
    return referenceSettings;
  },
  reload: async () => {
    const settings = await ipc.getSettings();
    set({ settings, loaded: true });
    return settings;
  },
}));
