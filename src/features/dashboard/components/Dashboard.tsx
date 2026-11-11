import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { buildTopItems } from "../services/dashboardFormatting.ts";
import { useTodayNotes } from "../hooks/useTodayNotes.ts";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { DashboardReadModel } from "../services/dashboardReadModel.ts";
import type { DashboardReadState } from "../hooks/useDashboardStats.ts";
import AppsModule from "./AppsModule.tsx";
import ItemsModule from "./ItemsModule.tsx";
import NotesStrip from "./NotesStrip.tsx";
import TimerModule from "./TimerModule.tsx";
import TodosModule from "./TodosModule.tsx";
import TimelineCard from "./TimelineCard.tsx";
import AddCardDialog from "../layout/AddCardDialog";
import CardControls from "../layout/CardControls";
import { columnRowTokens, type LayoutCard } from "../layout/contract";
import { buildFocusDistribution, isFocusDimension, type FocusDimension } from "../services/focusDimension.ts";
import { useDashboardLayout } from "../layout/useDashboardLayout";

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
  /** 「全部分类…」→ 分类映射视图 */
  onOpenMapping: () => void;
}

export default function Dashboard({
  dashboard,
  icons,
  readState,
  refreshKey,
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
  const todosModel = useTodayTodos(refreshKey);
  const notesModel = useTodayNotes(refreshKey);

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
  const rowStyle = (cards: LayoutCard[]) => {
    const rows = columnRowTokens(cards);
    return rows.length > 0 ? { gridTemplateRows: rows.join(" ") } : undefined;
  };
  const controlsFor = useCallback((card: LayoutCard, label: string, siblings: LayoutCard[]) => {
    const at = siblings.findIndex((item) => item.id === card.id);
    return (
      <CardControls
        id={card.id}
        tier={card.tier}
        label={label}
        canMoveUp={at > 0}
        canMoveDown={at >= 0 && at < siblings.length - 1}
        onMove={(direction) => layout.moveCard(card.id, direction)}
        onTier={(tier) => layout.setCardTier(card.id, tier)}
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
    sessions: compiledSessions,
  });

  const renderCards = (cards: LayoutCard[]) => cards.map((card) => {
    switch (card.id) {
      case "timer":
        return (
          <TimerModule
            key={card.id}
            controls={controlsFor(card, labelOf(card.id), cards)}
            categoryDist={focus.slices.map((slice) => ({
              category: slice.category ?? "other",
              name: slice.name,
              value: slice.value,
              color: slice.color,
            }))}
            dimension={focusDimension}
            onDimensionChange={(next) => layout.setCardOption("timer", "dimension", next)}
            totalTrackedTime={totalTrackedTime}
            dayDeltaTrackedTime={dayDeltaTrackedTime}
            {...snapshotProps}
          />
        );
      case "items":
        return (
          <ItemsModule
            key={card.id}
            items={topItems}
            total={topItemTotal}
            controls={controlsFor(card, labelOf(card.id), cards)}
            {...snapshotProps}
          />
        );
      case "apps":
        return (
          <AppsModule
            key={card.id}
            controls={controlsFor(card, labelOf(card.id), cards)}
            applications={topApplications}
            icons={icons}
            onOpenMapping={onOpenMapping}
            {...snapshotProps}
          />
        );
      case "todos":
        return (
          <TodosModule
            key={card.id}
            model={todosModel}
            controls={controlsFor(card, labelOf(card.id), cards)}
          />
        );
      default:
        /* 列内卡只认这四张；通栏卡由 renderFullCard 处理（trend / reminder / timeline 排 P3）。 */
        return null;
    }
  });
  const renderFullCard = (card: LayoutCard) => {
    if (card.id === "notes") return <NotesStrip model={notesModel} />;
    /* [P3] 事项菜单卡：只读按时序（数据来自同一份 compiledSessions，不新增宿主命令）。 */
    if (card.id === "timeline") {
      return (
        <TimelineCard
          controls={controlsFor(card, labelOf(card.id), layout.full)}
          sessions={compiledSessions}
          tier={card.tier}
          status={snapshotStatus}
          refreshError={refreshError}
          onRetry={readState.retry}
        />
      );
    }
    return null;
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

      {/* [P1 修复] 工具条是板子的兄弟节点，不许进 `.qp-main-view`：
          放进去会占掉网格的首行，把双列区压扁。 */}
      <div className="qp-dashboard-toolbar">
        <button type="button" className="qp-link-btn" onClick={() => setAddOpen(true)}>
          {copy.addCard}
        </button>
      </div>

      <div className="qp-main-view" aria-busy={snapshotStatus === "loading" || undefined}>
        <div className="qp-ws">
          <div className="qp-col qp-col-left" style={rowStyle(layout.left)}>
            {renderCards(layout.left)}
          </div>
          <div className="qp-col qp-col-right" style={rowStyle(layout.right)}>
            {renderCards(layout.right)}
          </div>
        </div>
        {layout.full.map((card) => (
          <Fragment key={card.id}>{renderFullCard(card)}</Fragment>
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
