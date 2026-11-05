/**
 * Timing — Markdown 同步 store（V0.4.0 / 插件 API v2）
 * -----------------------------------------------------------------------------
 * 只缓存「设置页正在看的那一份视图」：配置 + 最近一次运行状态。
 * 真正的同步在 Rust 侧轮询执行；本 store 不参与同步判定，避免前后端各算一套。
 */
import { create } from 'zustand';
import { mdSyncApi } from '../services/api';
import { errorText } from '../services/ipc';
import type { MdSyncConfig, MdSyncReport, MdSyncView } from '../types/domain';

interface MdSyncStore {
  view: MdSyncView | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  /** 加载 / 保存失败（逐条落点错误在 view.status.bindings[i].lastError 里） */
  error: string | null;
  load: () => Promise<MdSyncView | null>;
  save: (config: MdSyncConfig) => Promise<MdSyncView>;
  run: () => Promise<MdSyncReport>;
  clearError: () => void;
}

export const useMdSyncStore = create<MdSyncStore>((set) => ({
  view: null,
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  clearError: () => set({ error: null }),
  load: async () => {
    set({ loading: true, error: null });
    try {
      const view = await mdSyncApi.get();
      set({ view, loaded: true });
      return view;
    } catch (err) {
      set({ loaded: true, error: errorText(err) });
      return null;
    } finally {
      set({ loading: false });
    }
  },
  save: async (config) => {
    set({ saving: true, error: null });
    try {
      const view = await mdSyncApi.save(config);
      set({ view, loaded: true });
      return view;
    } catch (err) {
      set({ error: errorText(err) });
      throw err;
    } finally {
      set({ saving: false });
    }
  },
  run: async () => {
    set({ error: null });
    try {
      const report = await mdSyncApi.run();
      const view = await mdSyncApi.get();
      set({ view, loaded: true });
      return report;
    } catch (err) {
      set({ error: errorText(err) });
      throw err;
    }
  },
}));
