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
import ManageCard from "./ManageCard.tsx";
import type { ManageCardActions } from "./ManageCard.tsx";
import NotesStrip from "./NotesStrip.tsx";
import TimerModule from "./TimerModule.tsx";
import TimelineTodosCard from "./TimelineTodosCard.tsx";
import TrendModule from "./TrendModule.tsx";
import ReminderModule from "./reminder/ReminderModule.tsx";
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
  /** [0.12.6] 今日时间线卡 / 事项管理卡共用的今日事项切片
   *  （[0.13.x] 时间线卡还要两个本地回执接新建 / 编辑；[本轮] `items` 不再需要 ——
   *  时间线卡的「常用事项」组已下线） */
  todayItems: Pick<
    TodayItemsState,
    "rows" | "total" | "status" | "retry" | "applyLocalRename" | "applyLocalCreate"
  >;
  snapshotProps: { status: DashboardReadState["status"]; refreshError: boolean; onRetry: () => void };
  /** [0.12.6 · T4] 事项管理卡的对外动作：行点击起停（`useItemTimerToggle`）+ 提示条出口 */
  itemActions: ManageCardActions;
  dayDeltaTrackedTime: number;
  /**
   * [M2] 被「工具」标签排除在统计之外的时长（`dashboardReadModel` 的 `excludedToolTime`）。
   *
   * 透传给计时卡做**空态的解释**：全是工具类应用时环里一个弧都没有，不解释一句
   * 「今天只有工具类应用（3h）」的话，用户只会看到一张写着"今天还没有记录"的空卡，
   * 而右下角的应用排行里明明有三行时长 —— 那是"卡坏了"的观感。
   *
   * 类型跟着读模型走（`number | undefined`）：最小读模型（测试里的构造点）不产这个字段。
   */
  excludedToolTime: DashboardReadModel["excludedToolTime"];
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
            /* 读模型算过的百分比原样透传（应用维度）：卡里再算一遍就是第二个口径（M1） */
            percentage: slice.percentage,
          }))}
          dimension={props.focusDimension}
          onDimensionChange={props.onDimensionChange}
          dayDeltaTrackedTime={props.dayDeltaTrackedTime}
          /* [M2] 「今天只有工具类应用」那句空态要用的数：被统计口径排除掉的时长 */
          excludedToolTime={props.excludedToolTime}
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
    case "notes":
      return <NotesStrip model={props.notesModel} controls={controls} />;
    case "timeline":
      /* [0.12.6] 原「待办事项」+ 原「今日时间线」两张卡合并成这一张：上区待办、下区时间线。
         `todosModel` / `todayItems` 都由 `Dashboard.tsx` 提起，这里只做透传（不重复取数）。 */
      return (
        <TimelineTodosCard
          title={label}
          controls={controls}
          todayItems={props.todayItems}
          todosModel={props.todosModel}
          refreshError={props.refreshError}
        />
      );
    case "manage":
      /* [0.12.6] 事项管理是**独立的一张卡**（用户口径）：常用/历史事项、增删改管、
         AI 一键分类、绑定标记、点一下起停。起停与提示条在 `Dashboard.tsx` 装配一次，
         多张 manage 卡共用同一份。 */
      return (
        <ManageCard
          title={label}
          controls={controls}
          todayItems={props.todayItems}
          todos={props.todosModel.todos}
          actions={props.itemActions}
        />
      );
    case "trend":
      return <TrendModule controls={controls} model={props.trend} />;
    case "heatmap":
      return <HeatmapModule controls={controls} state={props.heatmap} />;
    case "reminder":
      return <ReminderModule controls={controls} icons={props.icons} />;
    default:
      return <CardPlaceholder card={card} controls={controls} />;
  }
}

export function CardPlaceholder({ card, controls }: { card: BoardCard; controls: ReactNode }) {
  const copy = DASHBOARD_COPY[useLocale()];
  return (
    <section className="at-card at-card-placeholder" data-card={card.kind}>
      <div className="at-card-head">
        <h2 className="at-card-title">{copy.cardLabels[card.kind] ?? card.kind}</h2>
        <span className="at-card-head-right">{controls}</span>
      </div>
      <p className="at-empty">这张卡还没做。布局已经记住它的位置与尺寸，实现后会自动出现在这里。</p>
    </section>
  );
}
