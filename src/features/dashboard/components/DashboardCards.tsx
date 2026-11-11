/**
 * [体积 · 0.12.1] 主界面的卡片装配：卡 id → 具体组件。
 *
 * 为什么单开一个文件：Dashboard 已顶到 300 行冻结线，加占位卡与拖拽手柄时连 4 行都塞不进去。
 * 这里只做「按 id 分发」，不持有状态、不做数据派生 —— 那些留在 Dashboard。
 *
 * 一条硬纪律：**任何卡都不许返回 `null`**。上一版对 trend / reminder 返回 null，
 * 用户点「添加」后板上只多出一块看不见的空槽（症状：「新增的图窗未显示」「大小也调不了」，
 * 因为可拖的东西根本不存在）。没实现的卡一律渲染 `CardPlaceholder`。
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import { ROW_CARDS, type CardId, type LayoutCard } from "../layout/contract.ts";
import CardSlot from "../layout/CardSlot.tsx";
import type { FocusDimension, FocusDistribution } from "../services/focusDimension.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import type { DashboardReadState } from "../hooks/useDashboardStats.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import AppsModule from "./AppsModule.tsx";
import ItemsModule from "./ItemsModule.tsx";
import NotesStrip from "./NotesStrip.tsx";
import TimerModule from "./TimerModule.tsx";
import TimelineCard from "./TimelineCard.tsx";
import TodosModule from "./TodosModule.tsx";
import TrendModule from "./TrendModule.tsx";
import ReminderModule from "./ReminderModule.tsx";
import type { TrendState } from "../hooks/useTrendDays.ts";
import type { PendingRemindersState } from "../hooks/usePendingReminders.ts";
import type { TopItemEntry } from "../services/dashboardFormatting.ts";
import type { DashboardReadModel } from "../services/dashboardReadModel.ts";
import type { TodayNotesState } from "../hooks/useTodayNotes.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";

interface CardProps {
  layout: {
    moveCard: (id: CardId, direction: -1 | 1) => void;
    setCardTier: (id: CardId, tier: LayoutCard["tier"]) => void;
    removeCard: (id: CardId) => void;
    full: LayoutCard[];
  };
  controlsFor: (card: LayoutCard, label: string, siblings: LayoutCard[]) => ReactNode;
  /** [单独宽度] 卡右边缘手柄的按下入口，由 `useCardWidthResize` 给 */
  onWidthDown: (event: ReactPointerEvent<HTMLElement>) => void;
  labelOf: (id: CardId) => string;
  copy: (typeof DASHBOARD_COPY)[keyof typeof DASHBOARD_COPY];
  focus: FocusDistribution;
  focusDimension: FocusDimension;
  onDimensionChange: (dimension: FocusDimension) => void;
  topItems: TopItemEntry[];
  topItemTotal: number;
  topApplications: DashboardReadModel["topApplications"];
  icons: Record<string, string>;
  onOpenMapping: () => void;
  todosModel: TodayTodosState;
  notesModel: TodayNotesState;
  todayItems: { rows: TodayItemRow[] };
  snapshotProps: { status: DashboardReadState["status"]; refreshError: boolean; onRetry: () => void };
  totalTrackedTime: number;
  dayDeltaTrackedTime: number;
  snapshotStatus: DashboardReadState["status"];
  refreshError: boolean;
  onRetry: () => void;
  /* [0.12.1] 两张新卡各自的数据源：趋势走按日聚合，提醒走 reminder_pending */
  trend: TrendState;
  reminders: PendingRemindersState;
}

/** `siblings` 是卡头上下移的参照列：卡被拉到通栏时参照的是 `layout.full`，不是它自己。 */
export function buildCard(card: LayoutCard, props: CardProps, siblings: LayoutCard[]): ReactNode {
  const controls = props.controlsFor(card, props.labelOf(card.id), siblings);
  switch (card.id) {
    case "timer":
      return (
        <TimerModule
          controls={controls}
          categoryDist={props.focus.slices.map((slice) => ({
            category: slice.category ?? "other",
            name: slice.name,
            value: slice.value,
            color: slice.color,
          }))}
          dimension={props.focusDimension}
          onDimensionChange={props.onDimensionChange}
          totalTrackedTime={props.totalTrackedTime}
          dayDeltaTrackedTime={props.dayDeltaTrackedTime}
          {...props.snapshotProps}
        />
      );
    case "items":
      return (
        <ItemsModule
          items={props.topItems}
          total={props.topItemTotal}
          controls={controls}
          {...props.snapshotProps}
        />
      );
    case "apps":
      return (
        <AppsModule
          controls={controls}
          applications={props.topApplications}
          icons={props.icons}
          onOpenMapping={props.onOpenMapping}
          {...props.snapshotProps}
        />
      );
    case "todos":
      return <TodosModule model={props.todosModel} controls={controls} />;
    default:
      return <CardPlaceholder card={card} controls={controls} />;
  }
}

/**
 * 列内卡：每张卡套一个 `CardSlot`（宽度手柄 + 列内格数都在槽上）。
 *
 * 为什么不把 `grid-column` 直接写到卡上：卡是 `ModuleShell` 的 `.qp-card`，它同时被
 * 通栏路径复用；槽是唯一知道「这张卡这次占几格 / 高度是不是拖过」的地方。
 */
export function buildColumnCards(
  cards: LayoutCard[],
  props: CardProps,
  siblings: LayoutCard[] = cards,
): ReactNode[] {
  return cards.map((card) => (
    <CardSlot key={card.id} card={card} mode="column" onWidthDown={props.onWidthDown}>
      {buildCard(card, props, siblings)}
    </CardSlot>
  ));
}

export function buildFullCard(card: LayoutCard, props: CardProps): ReactNode {
  const controls = props.controlsFor(card, props.labelOf(card.id), props.layout.full);
  if (card.id === "notes") return <NotesStrip model={props.notesModel} />;
  if (card.id === "timeline") {
    return (
      <TimelineCard
        controls={controls}
        items={props.todayItems.rows}
        tier={card.tier}
        status={props.snapshotStatus}
        refreshError={props.refreshError}
        onRetry={props.onRetry}
      />
    );
  }
  if (card.id === "trend") return <TrendModule controls={controls} model={props.trend} />;
  if (card.id === "reminder") return <ReminderModule controls={controls} model={props.reminders} />;
  /* [卡片跨列] 行内卡（timer/items/apps/todos）拉到通栏时复用列内那一套分发 ——
   * 绝不写第二份 switch：两份必然漂移（上一版靠 `return <CardPlaceholder>` 兜底，
   * 于是「跨列」的结果永远是一张写着「这张卡还没做」的占位）。 */
  if (ROW_CARDS.includes(card.id)) return buildCard(card, props, props.layout.full);
  return <CardPlaceholder card={card} controls={controls} />;
}

/**
 * 未实现卡的占位：一张真正的卡（有标题、有移除按钮、有高度），不是一个空槽。
 * `trend` / `reminder` 在布局模型里合法，但渲染还没做 —— 布局记住它们，实现后自动出现。
 */
export function CardPlaceholder({ card, controls }: { card: LayoutCard; controls: ReactNode }) {
  const copy = DASHBOARD_COPY[useLocale()];
  return (
    <section className="qp-card qp-card-placeholder" data-card={card.id}>
      <div className="qp-card-head">
        <h2 className="qp-card-title">{copy.cardLabels[card.id] ?? card.id}</h2>
        <span className="qp-card-head-right">{controls}</span>
      </div>
      <p className="qp-empty">这张卡还没做。布局已经记住它的位置与高度，实现后会自动出现在这里。</p>
    </section>
  );
}

