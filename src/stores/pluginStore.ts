/**
 * TickBar — 插件 store（V0.3.2 / V0.3.4）
 * -----------------------------------------------------------------------------
 * 插件元数据只在**内存**里缓存，不落库：它的事实来源是磁盘上的 `plugin.json`，
 * 缓存只是为了「每次打开摸鱼菜单不重新扫目录」。设置页的「重新加载」= 再扫一遍。
 *
 * 载入失败时保留 `FALLBACK_QUICK_TIMERS`：后端早期（或 IPC 异常）不该让摸鱼菜单
 * 变成一张空白菜单——那比显示三条默认预设更让人困惑。
 *
 * [V0.3.4] 删掉 `builtin` 状态：设置页不再展示任何内置功能（ADR-023），
 * 出厂预设只作为后端合并的底座存在，前端没有第二个消费者。
 */
import { create } from 'zustand';
import { pluginApi } from '../services/api';
import type { PluginInfo, QuickTimer } from '../types/domain';

/** 内置兜底（与 Rust `services::plugin::builtin_quick_timers()` 同源；这是应用内置功能，不是插件） */
export const FALLBACK_QUICK_TIMERS: readonly QuickTimer[] = [
  { item: '上厕所', minutes: 10 },
  { item: '摸鱼', minutes: 25 },
  { item: '吃饭', minutes: 60 },
];

interface PluginStore {
  /** 用户插件目录（可写、可在资源管理器打开） */
  dir: string;
  plugins: PluginInfo[];
  /** 已合并去重的菜单项（后端算好；后端不可用时为兜底三条） */
  quickTimers: QuickTimer[];
  loaded: boolean;
  loading: boolean;
  /** 整体加载失败（不是单个插件的 error——那些在 plugins[i].error 里） */
  error: string | null;
  load: () => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  dir: '',
  plugins: [],
  quickTimers: [...FALLBACK_QUICK_TIMERS],
  loaded: false,
  loading: false,
  error: null,
  load: async () => {
    /* 并发去抖：设置页连点「重新加载」不发 N 次 IPC */
    if (get().loading) return;
    set({ loading: true });
    try {
      const result = await pluginApi.list();
      set({
        dir: result.dir,
        plugins: result.plugins,
        quickTimers: result.quickTimers.length > 0 ? result.quickTimers : [...FALLBACK_QUICK_TIMERS],
        loaded: true,
        error: null,
      });
    } catch (err) {
      set({
        loaded: true,
        error: err instanceof Error ? err.message : '插件加载失败',
      });
    } finally {
      set({ loading: false });
    }
  },
}));
