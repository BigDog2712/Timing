import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  onMainToolsTargetChanged,
  takeMainToolsTarget,
} from "../../platform/desktop/mainToolsNavigationGateway.ts";
import { parseLocalDateKey, startOfLocalDay } from "../../shared/lib/localDate.ts";

/** `History` 的跳日请求：`requestId` 自增，`History` 靠它识别「又一次跳到同一天」。 */
export type HistoryDateRequest = { dateKey: string; requestId: number; focusApp?: string | null };

export type MainToolsNavigationDeps = {
  /** AppShell 的视图切换（含未保存确认）；`navigated: false` = 用户取消了 */
  navigate: (
    view: "dashboard" | "history" | "settings",
  ) => Promise<{ navigated: boolean }>;
  setHistoryDateRequest: Dispatch<SetStateAction<HistoryDateRequest | null>>;
};

/** 只接受「合法的本地日 且 不晚于今天」——与 `AppShell.openHistoryForDate` 同一口径。 */
function isSelectableDateKey(dateKey: string): boolean {
  const date = parseLocalDateKey(dateKey);
  return date !== null && startOfLocalDay(date) <= startOfLocalDay(new Date());
}

/**
 * 宿主`药丸`（label = `main`）→ 分析窗（label = `patina`）的落点消费。
 *
 * [T04 缩形] 原名 `useMainToolsNavigation` 还挂着"工具分区跳转"的职责——标题栏与
 * 迷你窗的两处工具状态灯整簇下线后，只剩「打开主界面」一档：
 *   ① 历史落点（日期 + 可选聚焦应用）；
 *   ② 设置落点（托盘「设置…」与药丸手柄 `settings.open`）；
 *   ③ 总览落点（P1-02）；
 *   ④ 网关仍可能送来 `kind: "tools"`（托盘菜单是 Rust 侧存量，本轮不动）——工具页没了，
 *      它退化成「打开主界面」，落到 dashboard。**不许静默丢弃**：点了托盘至少把窗叫回来。
 *
 * **订阅必须先于 take**：冷启动时后端的 `emit_to` 一定丢失，唯一的保证是「挂载时也
 * 取一次」。`take` 是一次性语义，连点两次「今天」只落最后一次（目标幂等）。
 */
export function useMainToolsNavigation(deps: MainToolsNavigationDeps): void {
  const { navigate, setHistoryDateRequest } = deps;

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
   * 与历史落点同一口径：不重试、不提示，用户再点一次。
   */
  const openOverview = useCallback(() => navigate("dashboard"), [navigate]);

  /**
   * 设置视图落点（[0.12.1]：托盘「设置…」与药丸手柄 `settings.open`）。
   *
   * 独立设置窗已下线，这里只切视图；与总览同一口径——被未保存确认拦住就到此为止，
   * 不重试、不提示。清 `historyDateRequest` 不必要：设置页不消费它，而它的一次性
   * 语义有 take/requestId 管着。
   */
  const openSettings = useCallback(() => navigate("settings"), [navigate]);

  /* [T04] 工具落点 → 「打开主界面」：工具分区没了，落在主界面的家（dashboard）。 */
  const openHome = openOverview;

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const consume = async () => {
      if (disposed) return;
      try {
        const target = await takeMainToolsTarget();
        if (!target || disposed) return;
        if (target.kind === "tools") await openHome();
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
  }, [openHistory, openOverview, openSettings, openHome]);
}
