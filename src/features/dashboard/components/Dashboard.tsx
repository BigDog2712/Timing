import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { buildTopItems } from "../services/dashboardFormatting.ts";
import { useTodayNotes } from "../hooks/useTodayNotes.ts";
import { useTodayItems } from "../hooks/useTodayItems.ts";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import { useTrendDays } from "../hooks/useTrendDays.ts";
import { usePendingReminders } from "../hooks/usePendingReminders.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { DashboardReadModel } from "../services/dashboardReadModel.ts";
import type { DashboardReadState } from "../hooks/useDashboardStats.ts";
import AddCardDialog from "../layout/AddCardDialog";
import CardControls from "../layout/CardControls";
import type { LayoutCard } from "../layout/contract";
import { buildFocusDistribution, isFocusDimension, type FocusDimension } from "../services/focusDimension.ts";
import { useDashboardLayout } from "../layout/useDashboardLayout";
import { useCardResize } from "../layout/useCardResize.ts";
import { useCardWidthResize } from "../layout/useCardWidthResize.ts";
import { useCardDrag } from "../layout/useCardDrag.ts";
import { buildGridCards } from "./DashboardCards.tsx";

/**
 * 今日视图（设计五模块）—— 只做**数据装配 + 五模块组合**，布局全在
 * `styles/features/dashboard*.css`，每个模块在自己的文件里（01 §4.7 行数预算）。
 *
 * 相对旧版（513 行）删掉的东西，逐条都有落点：
 *   · `QuietPageHeader`「今日」页头 → 设计里没有页头（顶栏 tab 已声明位置，01 §4.1）
 *   · `HourlyActivityChart` 今日节律 → **设计五模块里没有这一块**（01 §4.1/§4.2），
 *     数据 `hourlyActivity` 仍在 `DashboardReadModel` 里（历史视图自己也在算），
 *     本轮只是不再在主界面画它；删除记档，不是功能删除。
 *   · `DashboardFocusDonut` 内联函数 → `TimerModule.tsx`（几何换档：viewBox 144）
 *   · 应用排行「卡中卡 + 双击详情 + 右键快捷分类」→ `AppsModule.tsx`（裸排行 + 发丝 +
 *     通栏 footer「全部分类…」；两条旧路径的第二个出口见该文件顶部注释）
 *   · 分类数 4/6 的 `ResizeObserver`（按卡宽展开）→ 固定 5 行（设计是 5 行读数）
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
  const copy = DASHBOARD_COPY[useLocale()];
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

  /* 待办 / 便利贴是**独立源**，它们的 hook 提到这一层：E5 的 `hasAnyData()` 必须能看见
   * 这两个源 —— 只统计快照的话，"快照挂了 → 整页覆盖 → 用户以为数据没了"会换了件衣服回来。 */
  /* [P2 修正] 今日事项（Timing 自己的 items + time_records）：事项维度与事项菜单卡共用一份。 */
  const todayItems = useTodayItems(refreshKey, refreshIntervalSecs);
  const todosModel = useTodayTodos(refreshKey);
  const notesModel = useTodayNotes(refreshKey);
  /* [0.12.1] 趋势与提醒各自一条独立源：它们跟"快照"没关系，快照挂了这两张卡照旧能画。 */
  const trendModel = useTrendDays(refreshKey);
  const reminderModel = usePendingReminders(refreshKey);

  const { compiledSessions, categoryDist, topApplications, totalTrackedTime, dayDeltaTrackedTime } = dashboard;
  const { items: topItems, total: topItemTotal } = useMemo(() => buildTopItems(compiledSessions), [compiledSessions]);

  /* E3 = 快照失败但仍有数据（卡头小图标）；E2 = 失败且无数据（卡内一块）。同一处分派，不另算 */
  const snapshotStatus = readState.status;
  const refreshError = snapshotStatus === "error" && readState.hasSnapshot;
  /* E5 收窄（02 §14.4 第一条）：全源失败 **且** 首屏零数据。待办/便利贴有数据时退化成
   * 「三卡 E2 + 那两个正常」，**不许**整页覆盖。 */
  const hasAnyData = readState.hasSnapshot || todosModel.todos.length > 0 || notesModel.notes.length > 0;
  const showPageError = snapshotStatus === "error" && !hasAnyData;
  const snapshotProps = { status: snapshotStatus, refreshError, onRetry: readState.retry };

  /* [P1 · 0.12.1] 卡序与列由布局模型给，行高仍取既有令牌：默认布局拼出来的
     `grid-template-rows` 与 `.qp-col-left/right` 里那两条硬编码逐字相同 —— B1 靠这条成立。 */
  const layout = useDashboardLayout();
  const [addOpen, setAddOpen] = useState(false);
  /* [拖拽调整占行] 卡下边缘拖高：改 h（1 或 2 行），拖动中只改界面，松手才落盘。 */
  const cardResize = useCardResize({
    onPreview: (id, height) => layout.setCardH(id, height <= 400 ? 1 : 2, false),
    onCommit: (id, height) => layout.setCardH(id, height <= 400 ? 1 : 2, true),
  });
  /* [拖拽调整占宽] 卡右边缘拖宽：改 w（1..4 格），吸附整数格。 */
  const cardWidthResize = useCardWidthResize({
    onPreview: (id, width) => layout.setCardW(id, width, false),
    onCommit: (id, width) => layout.setCardW(id, width, true),
  });
  /* [拖拽排序] 卡头 grip 拖动重排：dense 让位，松手落盘。 */
  const cardDrag = useCardDrag({
    onPreview: (id, col, row) => layout.repositionCard(id, col, row, false),
    onCommit: (id, col, row) => layout.repositionCard(id, col, row, true),
  });

  const controlsFor = useCallback((card: LayoutCard, label: string) => {
    const cards = layout.layout.cards;
    const at = cards.findIndex((item) => item.id === card.id);
    return (
      <CardControls
        id={card.id}
        tier={card.tier}
        w={card.w}
        label={label}
        canMoveUp={at > 0}
        canMoveDown={at >= 0 && at < cards.length - 1}
        onMove={(direction) => layout.moveCard(card.id, direction)}
        onTier={(tier) => layout.setCardTier(card.id, tier)}
        onWidth={(w) => layout.setCardW(card.id, w)}
        onRemove={() => layout.removeCard(card.id)}
      />
    );
  }, [layout]);
  const labelOf = (id: LayoutCard["id"]) => copy.cardLabels[id] ?? id;

  /* [P2] 专注卡的三维度：参数存在卡自己的 `options.dimension` 里（C2：该字典只有这一个键）。 */
  const storedDimension = layout.cardOption("timer", "dimension");
  const focusDimension: FocusDimension = isFocusDimension(storedDimension) ? storedDimension : "category";
  const focus = buildFocusDistribution(focusDimension, {
    categories: categoryDist,
    applications: topApplications,
    items: todayItems.rows,
  });

  /* [体积] 卡片装配搬到 `DashboardCards.tsx`：本文件已顶到 300 行冻结线，
     加占位卡与手柄时连 4 行都塞不进去。这里只留状态、派生与两端调用。 */
  const cardProps = {
    layout, controlsFor, labelOf, copy,
    onWidthDown: cardWidthResize.onPointerDown,
    draggingId: cardDrag.draggingId,
    focus, focusDimension,
    onDimensionChange: (next: FocusDimension) => layout.setCardOption("timer", "dimension", next),
    topItems, topItemTotal, topApplications, icons, onOpenMapping,
    todosModel, notesModel, todayItems, snapshotProps,
    totalTrackedTime, dayDeltaTrackedTime,
    snapshotStatus, refreshError, onRetry: readState.retry,
    trend: trendModel, reminders: reminderModel,
  };
  const renderCards = (cards: LayoutCard[]) => buildGridCards(cards, cardProps);

  /* 三种抓取（拖高 / 拖宽 / 拖排）共用板子这一处 onPointerDown，各认各的手柄：
   * 手柄选择器互斥（`.qp-card-resize` / `.qp-card-width` / `.qp-card-grip`），
   * 一次 pointerdown 只可能命中一个，谁先 `closest` 到谁接管。 */
  const handleBoardPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    cardResize.onPointerDown(event);
    cardWidthResize.onPointerDown(event);
    cardDrag.onPointerDown(event);
  }, [cardResize, cardWidthResize, cardDrag]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="qp-dashboard"
      onPointerDown={handleBoardPointerDown}
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

      {/* [v2] 工具条是板子的兄弟节点，不许进 `.qp-main-view`。 */}
      <div className="qp-dashboard-toolbar">
        <button type="button" className="qp-link-btn" onClick={() => setAddOpen(true)}>
          {copy.addCard}
        </button>
        {/* `reset()` 一直存在但没有任何 UI 入口：卡片移除乱了之后用户无处可退。 */}
        <button type="button" className="qp-link-btn" onClick={layout.reset}>
          {copy.resetLayout}
        </button>
      </div>

      <div className="qp-main-view" aria-busy={snapshotStatus === "loading" || undefined}>
        <div className="qp-grid">
          {renderCards(layout.layout.cards)}
        </div>
      </div>
      {addOpen ? (
        <AddCardDialog
          present={layout.has}
          onAdd={layout.addCard}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </div>
  );
}
