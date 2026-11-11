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
import type { ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import type { CardId, LayoutCard } from "../layout/contract.ts";
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
}

export function buildColumnCards(cards: LayoutCard[], props: CardProps): ReactNode[] {
  return cards.map((card) => {
    const controls = props.controlsFor(card, props.labelOf(card.id), cards);
    switch (card.id) {
      case "timer":
        return (
          <TimerModule
            key={card.id}
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
            key={card.id}
            items={props.topItems}
            total={props.topItemTotal}
            controls={controls}
            {...props.snapshotProps}
          />
        );
      case "apps":
        return (
          <AppsModule
            key={card.id}
            controls={controls}
            applications={props.topApplications}
            icons={props.icons}
            onOpenMapping={props.onOpenMapping}
            {...props.snapshotProps}
          />
        );
      case "todos":
        return <TodosModule key={card.id} model={props.todosModel} controls={controls} />;
      default:
        return <CardPlaceholder key={card.id} card={card} controls={controls} />;
    }
  });
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

