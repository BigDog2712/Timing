/**
 * 插件清单的运行时缓存（分析窗侧，[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 宿主那份是 `src/stores/pluginStore.ts`（读不到：L9）。这里按同名对象、同名方法重建，
 * 搬过来的插件面板只改 import 路径。口径：
 *  - 只在**内存**里缓存，事实来源是磁盘上的 `plugin.json`；「重新加载」= 再扫一遍；
 *  - 并发去抖：连点不发 N 次 IPC；
 *  - 载入失败只在 `error` 里说一句，不抛给渲染层。
 * 与宿主那份的唯一差异：不再维护 `quickTimers`（模鱼菜单在主窗，分析窗不消费）。
 */
import { create } from "zustand";
import { pluginList } from "../../../../platform/desktop/hostPluginsGateway";
import type { PluginInfo } from "./hostTypes";

interface HostPluginStore {
  dir: string;
  plugins: PluginInfo[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const usePluginStore = create<HostPluginStore>((set, get) => ({
  dir: "",
  plugins: [],
  loaded: false,
  loading: false,
  error: null,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const result = await pluginList();
      set({
        dir: result.dir,
        plugins: result.plugins,
        loaded: true,
        error: null,
      });
    } catch (err) {
      set({
        loaded: true,
        error: err instanceof Error ? err.message : "插件加载失败",
      });
    } finally {
      set({ loading: false });
    }
  },
}));
