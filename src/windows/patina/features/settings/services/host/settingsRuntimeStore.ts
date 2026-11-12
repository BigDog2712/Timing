/**
 * 宿主设置在本窗的缓存（分析窗侧，[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 宿主那份是 `src/stores/settingsStore.ts`（读不到：L9）。这里按同名对象、同名方法重建：
 * `settings` / `referenceSettings` / `reload()` / `reloadReference()` / `setSettings` /
 * `setReferenceSettings`，让搬过来的「通用」面板只改 import 路径。
 *
 * 只保留分析窗真正读得到的字段形状（`HostSettings` / `HostReferenceSettings` 是**开放**的
 * `Record` 风格类型）：本文件不做业务默认值，缺字段由后端 `Settings::default()` 保证。
 *
 * 已知限制（写进交付说明）：宿主 `settingsStore` 是内存缓存且**没有跨窗失效通知**，
 * 所以「分析窗写完 → 药丸同一会话读旧值」这条残留仍然存在（T04a 已登记）。
 */
import { create } from "zustand";
import { getReferenceSettings, getSettings } from "../../../../platform/desktop/hostSettingsGateway";
import type { HostReferenceSettings, HostSettings } from "./hostTypes";

interface HostSettingsStore {
  settings: HostSettings | null;
  referenceSettings: HostReferenceSettings | null;
  loaded: boolean;
  setSettings: (settings: HostSettings) => void;
  setReferenceSettings: (settings: HostReferenceSettings) => void;
  reload: () => Promise<HostSettings>;
  reloadReference: () => Promise<HostReferenceSettings>;
}

export const useSettingsStore = create<HostSettingsStore>((set) => ({
  settings: null,
  referenceSettings: null,
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  setReferenceSettings: (referenceSettings) => set({ referenceSettings }),
  reload: async () => {
    const settings = await getSettings() as HostSettings;
    set({ settings, loaded: true });
    return settings;
  },
  reloadReference: async () => {
    const referenceSettings = await getReferenceSettings();
    set({ referenceSettings });
    return referenceSettings;
  },
}));
