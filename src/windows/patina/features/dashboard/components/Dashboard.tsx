import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useTodayNotes } from "../hooks/useTodayNotes.ts";
import { useTodayItems } from "../hooks/useTodayItems.ts";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import { useTrendDays } from "../hooks/useTrendDays.ts";
import { useHeatmapModel } from "../hooks/useHeatmapModel.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { DashboardReadModel } from "../services/dashboardReadModel.ts";
import type { DashboardReadState } from "../hooks/useDashboardStats.ts";
import { buildFocusDistribution, type FocusDimension } from "../services/focusDimension.ts";
import { useDashboardLayout } from "../layout/useDashboardLayout";
import { BOARD_COPY } from "../layout/boardCopy.ts";
import { displayTitle, type BoardCard } from "../layout/contract.ts";
import CardMenu from "../layout/CardMenu.tsx";
import DashboardBoard from "../layout/DashboardBoard.tsx";
import { buildCardBody } from "./DashboardCards.tsx";

/**
 * 今日视图 —— 只做**数据装配 + 组件板组合**。
 *
 * [v3 自由摆位] 定位/拖拽/缩放在 `layout/` 那一层（`BoardCanvas` + `DashboardBoard`），
 * 本文件不再知道「列」「网格」「占行」。它给板子两样东西：
 *   ① `renderBody(card)` —— 这张卡里画什么（数据全在这里装配）；
 *   ② `labelOf(card)`   —— 这张卡叫什么（自定义标题优先）。
 *
 * 保留了 v2 的一条纪律：**待办 / 便利贴 / 趋势 / 提醒各自一条独立源**，它们的 hook
 * 提到这一层，E5 的 `hasAnyData()` 必须能看见它们 —— 只统计快照的话，
 * 「快照挂了 → 整页覆盖 → 用户以为数据没了」会换了件衣服回来。
 */
interface Props {
  dashboard: DashboardReadModel;
  icons: Record<string, string>;
  readState: DashboardReadState;
  /** 前台刷新信号：便利贴 / 待办两张卡自己按它重拉 */
  refreshKey: number;
  /** [P2 修正] 事项卡/便利贴的刷新间隔（用户设置里那个值，分析窗不自己拍） */
  refreshIntervalSecs: number;
  /** 「全部分类…」→ 分类映射视图 */
  onOpenMapping: () => void;
}

export default function Dashboard({
  dashboard,
  icons,
  readState,
  refreshKey,
  refreshIntervalSecs,
  onOpenMapping,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const boardCopy = BOARD_COPY[locale];
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnRetryFocusRef = useRef(false);

  /* 重试后焦点回落到重试键（02 §2.3 同口径）：读屏用户点「重试」→ 读取失败 →
     按钮消失 → 焦点落回 body。这里在状态回来时把它送回原处。 */
  useLayoutEffect(() => {
    if (readState.status === "loading" || !returnRetryFocusRef.current) return;
    if (document.activeElement === document.body) {
      const target = panelRef.current?.querySelector<HTMLElement>("[data-dashboard-read-error] button")
        ?? panelRef.current;
      target?.focus();
    }
    returnRetryFocusRef.current = false;
  }, [readState.status]);

  const todayItems = useTodayItems(refreshKey, refreshIntervalSecs);
  const todosModel = useTodayTodos(refreshKey);
  const notesModel = useTodayNotes(refreshKey);
  const trendModel = useTrendDays(refreshKey);
  const heatmapModel = useHeatmapModel(refreshKey);

  const { categoryDist, topApplications, totalTrackedTime, dayDeltaTrackedTime } = dashboard;

  /* E3 = 快照失败但仍有数据（卡头小图标）；E2 = 失败且无数据（卡内一块）。同一处分派，不另算 */
  const snapshotStatus = readState.status;
  const refreshError = snapshotStatus === "error" && readState.hasSnapshot;
  /* E5 收窄（02 §14.4 第一条）：全源失败 **且** 首屏零数据。待办/便利贴有数据时退化成
   * 「三卡 E2 + 那两个正常」，**不许**整页覆盖。 */
  const hasAnyData = readState.hasSnapshot || todosModel.todos.length > 0 || notesModel.notes.length > 0;
  const showPageError = snapshotStatus === "error" && !hasAnyData;
  const snapshotProps = { status: snapshotStatus, refreshError, onRetry: readState.retry };

  const layout = useDashboardLayout();
  /* 维度是**视图级**的（同一块板上多个计时卡共用一个口径）：分到每张卡上会出现
   * 「两张环一个按分类、一个按应用」，读数无法互相解释。 */
  const [focusDimension, setFocusDimension] = useState<FocusDimension>("category");
  const focus = buildFocusDistribution(focusDimension, {
    categories: categoryDist,
    applications: topApplications,
    items: todayItems.rows,
  });

  const labelOf = useCallback(
    (card: BoardCard) => displayTitle(card, copy.cardLabels),
    [copy.cardLabels],
  );

  const controlsFor = useCallback((card: BoardCard, label: string) => (
    <CardMenu
      label={label}
      title={card.title ?? ""}
      tier={card.tier}
      copy={boardCopy}
      onTier={(tier) => layout.setTier(card.uid, tier)}
      onRename={(title) => layout.setTitle(card.uid, title)}
      onDuplicate={() => layout.duplicate(card.uid)}
      onRemove={() => layout.remove(card.uid)}
    />
  ), [boardCopy, layout]);

  const cardProps = {
    controlsFor, copy,
    focus, focusDimension,
    onDimensionChange: setFocusDimension,
    topApplications, icons, onOpenMapping,
    todosModel, notesModel, todayItems, snapshotProps,
    totalTrackedTime, dayDeltaTrackedTime,
    snapshotStatus, refreshError, onRetry: readState.retry,
    trend: trendModel, heatmap: heatmapModel,
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="qp-dashboard"
      data-view="dashboard"
      data-dashboard-read-state={readState.status}
    >
      {/* 视觉上没有页头（01 §4.1 顶栏 tab 已声明位置），但读屏需要"这是哪一页" */}
      <h1 className="sr-only">{copy.pageTitle}</h1>

      {showPageError ? (
        <div className="qp-panel qp-dashboard-notice" role="status" data-dashboard-read-error>
          <span>{hasAnyData ? UI_TEXT.common.refreshFailed : UI_TEXT.common.readFailed}</span>
          <button
            type="button"
            className="qp-control shrink-0"
            onClick={(event) => {
              returnRetryFocusRef.current = document.activeElement === event.currentTarget;
              readState.retry();
            }}
          >
            {UI_TEXT.common.retry}
          </button>
        </div>
      ) : null}

      <div className="qp-main-view" aria-busy={snapshotStatus === "loading" || undefined}>
        <DashboardBoard
          layout={layout}
          copy={boardCopy}
          labelOf={labelOf}
          emptyText={boardCopy.empty}
          renderBody={(card) => buildCardBody(card, labelOf(card), cardProps)}
        />
      </div>
    </div>
  );
}
