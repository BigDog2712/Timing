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
import CardSlot from "../layout/CardSlot.tsx";
import type { LayoutCard } from "../layout/contract";
import { buildFocusDistribution, isFocusDimension, type FocusDimension } from "../services/focusDimension.ts";
import { useDashboardLayout } from "../layout/useDashboardLayout";
import { useCardResize } from "../layout/useCardResize.ts";
import { useCardWidthResize } from "../layout/useCardWidthResize.ts";
import { useSplitResize } from "../layout/useSplitResize.ts";
import { DEFAULT_SPLIT, FULL_ONLY_CARDS, MAX_SPLIT, MIN_SPLIT, SPLIT_TOTAL } from "../layout/contract";
import { buildColumnCards, buildFullCard } from "./DashboardCards.tsx";

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
  /* [拖拽调整大小] 卡下边缘 8px 拖高：拖动中只改界面，松手才落盘。 */
  const cardResize = useCardResize({
    onPreview: (id, height) => layout.setCardHeight(id, height, false),
    onCommit: (id, height) => layout.setCardHeight(id, height, true),
  });
  /* [单独宽度] 卡右边缘 12px 拖宽：同上，只改这张卡在自己列里占几格。 */
  const cardWidthResize = useCardWidthResize({
    onPreview: (id, width) => layout.setCardWidth(id, width, false),
    onCommit: (id, width) => layout.setCardWidth(id, width, true),
  });
  /* [列宽比可拖] 左列 fr 权重；右列 = SPLIT_TOTAL − split。默认值不写内联样式 ——
   * CSS 里那一行才是像素验收的正本（465.14 / 570.86），内联再重复一份必然漂。 */
  const split = layout.layout.split ?? DEFAULT_SPLIT;
  const splitResize = useSplitResize({
    split,
    onPreview: (next) => layout.setSplit(next, false),
    onCommit: (next) => layout.setSplit(next, true),
  });
  const wsStyle = split === DEFAULT_SPLIT
    ? undefined
    : {
      gridTemplateColumns:
        `minmax(320px, ${split}fr) var(--qp-card-gap) minmax(0, ${SPLIT_TOTAL - split}fr)`,
    };
  /* [单独宽度] 行高不再由这一层算：卡槽按 `data-card`/`data-tier` 自己定高，
   * 两张半宽的卡落进同一行时也各按自己的档位算，不会互相压（见 `CardSlot.tsx` 文件头）。 */
  /* [卡片跨列] 记一张卡跨列之前在哪一列：收回时回原位，而不是一律甩到左列。 */
  const spanFromRef = useRef(new Map<LayoutCard["id"], "left" | "right">());
  const toggleSpan = useCallback((card: LayoutCard) => {
    if (card.column === "full") {
      layout.setCardColumn(card.id, spanFromRef.current.get(card.id) ?? "left");
      return;
    }
    spanFromRef.current.set(card.id, card.column);
    layout.setCardColumn(card.id, "full");
  }, [layout]);
  const controlsFor = useCallback((card: LayoutCard, label: string, siblings: LayoutCard[]) => {
    const at = siblings.findIndex((item) => item.id === card.id);
    return (
      <CardControls
        id={card.id}
        tier={card.tier}
        label={label}
        spanning={card.column === "full"}
        /* notes / timeline / trend / reminder 天生通栏，给它们一个「收回单列」的键是假选择 */
        canToggleSpan={!FULL_ONLY_CARDS.includes(card.id)}
        onToggleSpan={() => toggleSpan(card)}
        canMoveUp={at > 0}
        canMoveDown={at >= 0 && at < siblings.length - 1}
        onMove={(direction) => layout.moveCard(card.id, direction)}
        onTier={(tier) => layout.setCardTier(card.id, tier)}
        onRemove={() => layout.removeCard(card.id)}
      />
    );
  }, [layout, toggleSpan]);
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
    focus, focusDimension,
    onDimensionChange: (next: FocusDimension) => layout.setCardOption("timer", "dimension", next),
    topItems, topItemTotal, topApplications, icons, onOpenMapping,
    todosModel, notesModel, todayItems, snapshotProps,
    totalTrackedTime, dayDeltaTrackedTime,
    snapshotStatus, refreshError, onRetry: readState.retry,
    trend: trendModel, reminders: reminderModel,
  };
  const renderCards = (cards: LayoutCard[]) => buildColumnCards(cards, cardProps);
  const renderFullCard = (card: LayoutCard) => buildFullCard(card, cardProps);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="qp-dashboard"
      onPointerDown={cardResize.onPointerDown}
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

      {/* [P1 修复] 工具条是板子的兄弟节点，不许进 `.qp-main-view`：
          放进去会占掉网格的首行，把双列区压扁。 */}
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
        <div className="qp-ws" style={wsStyle}>
          <div className="qp-col qp-col-left">
            {renderCards(layout.left)}
          </div>
          {/* [列宽比可拖] 分隔条是网格的第二格，宽 = `--qp-card-gap`（与原来的列间距等宽，
              所以默认比例下两列位置不动）。整条都能抓，不是 2px 细线。 */}
          <div
            className="qp-split"
            role="separator"
            aria-orientation="vertical"
            aria-label={copy.resizeColumns}
            aria-valuenow={split}
            aria-valuemin={MIN_SPLIT}
            aria-valuemax={MAX_SPLIT}
            tabIndex={0}
            onPointerDown={splitResize.onPointerDown}
          />
          <div className="qp-col qp-col-right">
            {renderCards(layout.right)}
          </div>
        </div>
        {/* 通栏卡也套一层槽：拖出来的 height 直接写在这里（inline 压过令牌），
            没有 height 时由 CSS 的 `data-card` 规则给令牌高度。 */}
        {layout.full.map((card) => (
          <CardSlot key={card.id} card={card} mode="full">
            {renderFullCard(card)}
          </CardSlot>
        ))}
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
