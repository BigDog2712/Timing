/**
 * [v3] 主界面的卡片装配：**卡类型 → 具体组件**。
 *
 * v3 起卡片有 `uid`（可重复），所以这里按 `kind` 分发，而不是按「唯一 id」。
 * 一条硬纪律不变：**任何卡都不许返回 null**（否则板上出现一个能拖能缩的空框）。
 *
 * 卡头右侧的 `⋯` 由 `controls` 注入：`CardMenu` 属布局层，卡内模块不应该知道
 * 「移除/复制」这些动作存在（v2 起就是这么分的，继续沿用）。
 */
import type { ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/index.ts";
import type { BoardCard } from "../layout/contract.ts";
import type { FocusDimension, FocusDistribution } from "../services/focusDimension.ts";
import type { TodayItemsState } from "../hooks/useTodayItems.ts";
import type { DashboardReadState } from "../hooks/useDashboardStats.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import AppsModule from "./AppsModule.tsx";
import HeatmapModule from "./HeatmapModule.tsx";
import NotesStrip from "./NotesStrip.tsx";
import TimerModule from "./TimerModule.tsx";
import TimelineCard from "./TimelineCard.tsx";
import TodosModule from "./TodosModule.tsx";
import TrendModule from "./TrendModule.tsx";
import type { TrendState } from "../hooks/useTrendDays.ts";
import type { HeatmapState } from "../hooks/useHeatmapModel.ts";
import type { DashboardReadModel } from "../services/dashboardReadModel.ts";
import type { TodayNotesState } from "../hooks/useTodayNotes.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";

interface CardProps {
  /** 卡头 `⋯`（改名 / 尺寸 / 复制 / 移除），由布局层给 */
  controlsFor: (card: BoardCard, label: string) => ReactNode;
  copy: (typeof DASHBOARD_COPY)[keyof typeof DASHBOARD_COPY];
  focus: FocusDistribution;
  focusDimension: FocusDimension;
  onDimensionChange: (dimension: FocusDimension) => void;
  topApplications: DashboardReadModel["topApplications"];
  icons: Record<string, string>;
  onOpenMapping: () => void;
  todosModel: TodayTodosState;
  notesModel: TodayNotesState;
  todayItems: Pick<TodayItemsState, "rows" | "applyLocalRename" | "applyLocalCreate">;
  snapshotProps: { status: DashboardReadState["status"]; refreshError: boolean; onRetry: () => void };
  totalTrackedTime: number;
  dayDeltaTrackedTime: number;
  snapshotStatus: DashboardReadState["status"];
  refreshError: boolean;
  onRetry: () => void;
  trend: TrendState;
  heatmap: HeatmapState;
}

export type CardBodyProps = CardProps;

/** 按 `kind` 分发卡内组件。`label` 用实例自己的标题（改名后菜单里的名字跟着变）。 */
export function buildCardBody(card: BoardCard, label: string, props: CardProps): ReactNode {
  const controls = props.controlsFor(card, label);
  switch (card.kind) {
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
      return <NotesStrip model={props.notesModel} controls={controls} />;
    case "timeline":
      return (
        <TimelineCard
          controls={controls}
          items={props.todayItems.rows}
          tier={card.tier}
          status={props.snapshotStatus}
          refreshError={props.refreshError}
          onRetry={props.onRetry}
          onLocalRename={props.todayItems.applyLocalRename}
          onLocalCreate={props.todayItems.applyLocalCreate}
        />
      );
    case "trend":
      return <TrendModule controls={controls} model={props.trend} />;
    case "heatmap":
      return <HeatmapModule controls={controls} state={props.heatmap} />;
    default:
      return <CardPlaceholder card={card} controls={controls} />;
  }
}

export function CardPlaceholder({ card, controls }: { card: BoardCard; controls: ReactNode }) {
  const copy = DASHBOARD_COPY[useLocale()];
  return (
    <section className="qp-card qp-card-placeholder" data-card={card.kind}>
      <div className="qp-card-head">
        <h2 className="qp-card-title">{copy.cardLabels[card.kind] ?? card.kind}</h2>
        <span className="qp-card-head-right">{controls}</span>
      </div>
      <p className="qp-empty">这张卡还没做。布局已经记住它的位置与尺寸，实现后会自动出现在这里。</p>
    </section>
  );
}
