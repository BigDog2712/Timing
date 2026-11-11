/**
 * [体积 · 0.12.1 / v2] 主界面的卡片装配：卡 id → 具体组件。
 *
 * v2 起所有卡走同一条路径（没有「列内/通栏」之分）：每张卡套一个 CardSlot（网格定位），
 * 卡内组件按 id 分发。一条硬纪律：**任何卡都不许返回 null**（否则加卡后是空槽）。
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import type { CardId, LayoutCard } from "../layout/contract.ts";
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
  controlsFor: (card: LayoutCard, label: string) => ReactNode;
  onWidthDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** [拖拽排序] 正在拖的卡 id（null = 没在拖）。 */
  draggingId: CardId | null;
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
  trend: TrendState;
  reminders: PendingRemindersState;
}

/** 按 id 分发卡内组件。controls 由调用方给（CardControls 是 layout 层，卡内不知道）。 */
export function buildCard(card: LayoutCard, props: CardProps): ReactNode {
  const controls = props.controlsFor(card, props.labelOf(card.id));
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
    case "notes":
      return <NotesStrip model={props.notesModel} />;
    case "timeline":
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
    case "trend":
      return <TrendModule controls={controls} model={props.trend} />;
    case "reminder":
      return <ReminderModule controls={controls} model={props.reminders} />;
    default:
      return <CardPlaceholder card={card} controls={controls} />;
  }
}

/** 网格卡：每张套一个 CardSlot（网格定位 + 宽度手柄）。 */
export function buildGridCards(cards: LayoutCard[], props: CardProps): ReactNode[] {
  return cards.map((card) => (
    <CardSlot
      key={card.id}
      card={card}
      onWidthDown={props.onWidthDown}
      dragging={props.draggingId === card.id}
    >
      {buildCard(card, props)}
    </CardSlot>
  ));
}

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
