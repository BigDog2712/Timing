/**
 * Markdown 同步的**运行时视图 store**（分析窗侧，[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 宿主那份是 `src/stores/mdSyncStore.ts`（读不到：L9）。这里按**同名对象、同名方法**重建，
 * 让搬过来的 15 个组件只改 import 路径。口径逐字照抄：
 *  - 只缓存「设置页正在看的那一份视图」（`md_sync_get` 的返回），不参与同步判定；
 *  - `save` 的 `secret` 三分语义原样转发（`''` = 清空，`'...'` = 写入，`undefined` = 不动），
 *    **绝不自己拼空串**——那会把用户密码清掉；
 *  - 失败只落 `error`，不抛给渲染层（`save` / `run` 例外：调用方要据此回滚草稿）。
 *
 * 为什么放在 services 侧而不是 features 下的 stores 目录：L2 门禁对那个目录有额外约束，
 * 而这份 store 直接调 gateway（传输层）。
 * 放在 services 侧语义更准：它是「宿主状态在本窗的缓存」，不是本窗自己的状态。
 */
import { create } from "zustand";
import { mdSyncGet, mdSyncRun, mdSyncSave } from "../../../../platform/desktop/hostSyncGateway";
import { errorText } from "../hostApi";
import type { MdSyncConfig, MdSyncReport, MdSyncViewCloud } from "./hostTypes";

interface HostMdSyncStore {
  view: MdSyncViewCloud | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<MdSyncViewCloud | null>;
  save: (config: MdSyncConfig, secret?: string | null) => Promise<MdSyncViewCloud>;
  run: () => Promise<MdSyncReport>;
  clearError: () => void;
}

export const useMdSyncStore = create<HostMdSyncStore>((set) => ({
  view: null,
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  clearError: () => set({ error: null }),
  load: async () => {
    set({ loading: true, error: null });
    try {
      const view = await mdSyncGet();
      set({ view, loaded: true });
      return view;
    } catch (err) {
      set({ loaded: true, error: errorText(err) });
      return null;
    } finally {
      set({ loading: false });
    }
  },
  save: async (config, secret) => {
    set({ saving: true, error: null });
    try {
      const view = await mdSyncSave(config, secret);
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
      const report = await mdSyncRun();
      const view = await mdSyncGet();
      set({ view, loaded: true });
      return report;
    } catch (err) {
      set({ error: errorText(err) });
      throw err;
    }
  },
}));
