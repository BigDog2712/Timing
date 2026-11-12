import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  onMainToolsTargetChanged,
  takeMainToolsTarget,
} from "../../platform/desktop/mainToolsNavigationGateway.ts";
import { parseLocalDateKey, startOfLocalDay } from "../../shared/lib/localDate.ts";
import type { ToolsOpenTarget } from "../../features/tools/types.ts";

/** `History` 的跳日请求：`requestId` 自增，`History` 靠它识别「又一次跳到同一天」。 */
export type HistoryDateRequest = { dateKey: string; requestId: number; focusApp?: string | null };

export type MainToolsNavigationDeps = {
  /** AppShell 的视图切换（含未保存确认）；`navigated: false` = 用户取消了 */
  navigate: (
    view: "tools" | "history" | "dashboard" | "settings",
  ) => Promise<{ navigated: boolean }>;
  setToolsInitialTarget: (target: ToolsOpenTarget | null) => void;
  setHistoryDateRequest: Dispatch<SetStateAction<HistoryDateRequest | null>>;
};

/** 打开工具页分区（标题栏胶囊 / 迷你窗 / 托盘菜单都用它）。 */
export type OpenToolsTarget = (target: ToolsOpenTarget) => void;

/** 只接受「合法的本地日 且 不晚于今天」——与 `AppShell.openHistoryForDate` 同一口径。 */
function isSelectableDateKey(dateKey: string): boolean {
  const date = parseLocalDateKey(dateKey);
  return date !== null && startOfLocalDay(date) <= startOfLocalDay(new Date());
}

/**
 * 宿主`药丸`（label = `main`）→ 分析窗（label = `patina`）的落点消费。
 *
 * 两件事合一（P0-03 把原先内联在 `AppShell` 的 `handleToolsStatusChipOpen` 收进来，
 * 腾出 `AppShell.tsx` 的冻结行数预算）：
 *  ① 返回 `openTools`：标题栏胶囊点一下就用它，行为与 V0.12.0 逐字一致；
 *  ② 挂载时 + 每次 `main-tools-target-changed` 门铃响时，`take` 一次 pending 目标。
 *
 * **订阅必须先于 take**：冷启动时后端的 `emit_to` 一定丢失，唯一的保证是「挂载时也
 * 取一次」。`take` 是一次性语义，连点两次「今天」只落最后一次（目标幂等）。
 */
export function useMainToolsNavigation(deps: MainToolsNavigationDeps): OpenToolsTarget {
  const { navigate, setHistoryDateRequest, setToolsInitialTarget } = deps;

  const openTools = useCallback(async (target: ToolsOpenTarget) => {
    if (!(await navigate("tools")).navigated) return;
    setHistoryDateRequest(null);
    /* 无 section = 「只进工具面」（顶栏入口门）：不设落点，且**必须显式清空** ——
       否则上一次没消费掉的落点会在这里生效，用户点门却跳去番茄钟。
       分区由 `Tools.tsx` 回落到它自己记住的分区。 */
    setToolsInitialTarget(target.section ? target : null);
  }, [navigate, setHistoryDateRequest, setToolsInitialTarget]);

  /**
   * 历史落点：日期 **+ 可选的聚焦应用**（`focusApp`）。
   *
   * `focusApp` 一路透传进 `History` 的 `selectedDateRequest`，由 `History.tsx` 做**纯派生
   * 比较**（请求日期 == 当前呈现日期）算出高亮键 —— 本 hook 不做匹配、不加状态、不碰渲染，
   * 也不为它新增任何命令或事件。
   */
  const openHistory = useCallback(
    async (target: { dateKey: string; focusApp: string | null }) => {
      if (!isSelectableDateKey(target.dateKey)) {
        console.warn("main window history target ignored", target.dateKey);
        return;
      }
      if (!(await navigate("history")).navigated) return;
      setHistoryDateRequest((current) => ({
        dateKey: target.dateKey,
        requestId: (current?.requestId ?? 0) + 1,
        focusApp: target.focusApp ?? null,
      }));
    },
    [navigate, setHistoryDateRequest],
  );

  /**
   * 总览落点（P1-02：摘要面板「在分析窗看总览 ↗」）。
   *
   * 只切视图、不带任何状态；被未保存确认拦住（`navigated: false`）就到此为止——
   * 与工具 / 历史落点同一口径：不重试、不提示，用户再点一次。
   */
  const openOverview = useCallback(() => navigate("dashboard"), [navigate]);

  /**
   * 设置视图落点（[0.12.1]：托盘「设置…」与药丸手柄 `settings.open`）。
   *
   * 独立设置窗已下线，这里只切视图；与总览同一口径——被未保存确认拦住就到此为止，
   * 不重试、不提示。清 `toolsInitialTarget` 与 `historyDateRequest` 不必要：
   * 设置页不消费这两份状态，而它们的一次性语义各自有 take/requestId 管着。
   */
  const openSettings = useCallback(() => navigate("settings"), [navigate]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const consume = async () => {
      if (disposed) return;
      try {
        const target = await takeMainToolsTarget();
        if (!target || disposed) return;
        if (target.kind === "tools") await openTools({ section: target.section });
        else if (target.kind === "settings") await openSettings();
        else if (target.kind === "overview") await openOverview();
        else await openHistory(target);
      } catch (error) { console.warn("main tools navigation failed", error); }
    };
    // Subscribe before consuming the pending target so cold startup cannot miss it.
    void onMainToolsTargetChanged(() => { void consume(); }).then(unlisten => {
      if (disposed) { unlisten(); return; }
      off = unlisten;
      void consume();
    }).catch(error => console.warn("main tools navigation subscription failed", error));
    return () => { disposed = true; off?.(); };
  }, [openTools, openHistory, openOverview, openSettings]);

  return useCallback((target: ToolsOpenTarget) => { void openTools(target); }, [openTools]);
}
