/**
 * 「今日时间线」卡（0.12.6）—— 原「待办事项」卡 + 原「今日时间线」卡合并，**只装配，不做业务**。
 *
 * ```
 * ┌─ 今日时间线 ────────────────────────── ⋯ ─┐   ← 卡头（标题 + 布局工具条）
 * │ 待办事项                 3 条待办 · 还有 1 项│   ← 上区：TodosZone（max-height 40%）
 * │ [新建待办]                                │
 * │ ☐ 写周报  ☐ 买菜                          │
 * ├──────────────────────────────────────────┤   ← 一条贯穿卡宽的浅横线（固定，不随滚动）
 * │ 今日时间线                     总计 6h12m │   ← 下区：TimelineZone（余下高度）
 * │ ● 正在进行 …  ○ 已完成 …                  │
 * └──────────────────────────────────────────┘
 * ```
 *
 * 三条结构决定（改这里之前先读 PRD §4 的线框）：
 *   ① 分隔线是**卡的直接子节点**，不在任何一个区里 —— 挂在区里就会跟着那一区滚（P1-1）。
 *   ② 两区各自 `overflow-y: auto`，页面级不滚；上区 `max-height: 40%` 是"有上限的自适应"，
 *      不是固定 40%（待办少的时候不该留一块空白）。**数字只有一处真相**：
 *      `shell/styles/features/dashboard-items-card.css` 的 `.at-card-items__upper`
 *      （`max-height: 40%`）。这里写 45% 骗过一轮 QA —— 注释里的数与 CSS 不一致时，
 *      读注释的人会按错的那个去算版面。
 *   ③ 数据全部由 props 进来（`Dashboard.tsx` 已经提起 `useTodayItems` / `useTodayTodos`），
 *      本文件一条 IPC 都不发 —— 合并卡不该让首屏多两次读。
 *
 * 「事项管理」**不在这张卡里**：它是独立的 `ManageCard`（用户口径，见设计文档 §⑦）。
 */
import type { ReactNode } from "react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { TodayItemsState } from "../hooks/useTodayItems.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";
import TimelineZone from "./TimelineZone.tsx";
import TodosZone from "./TodosZone.tsx";

/** 本卡用到的今日事项切片（`total` / `status` / `retry` 给下区的总计与四态）。 */
export type TimelineTodosCardModel = Pick<TodayItemsState, "rows" | "total" | "status" | "retry">;

interface Props {
  /** 卡头标题（`displayTitle(card, cardLabels)` 的结果：改名后跟着变） */
  title: string;
  /** 卡头右侧的布局工具条（上移/切档/移除，由布局层注入） */
  controls?: ReactNode;
  /** 今日事项（`useTodayItems` 的模型） */
  todayItems: TimelineTodosCardModel;
  /** 今日待办（`useTodayTodos` 的模型，独立源） */
  todosModel: TodayTodosState;
  /** E3：快照刷新失败（卡内小图标） */
  refreshError: boolean;
}

export default function TimelineTodosCard({
  title,
  controls,
  todayItems,
  todosModel,
  refreshError,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const domId = withInstance("t-timeline-todos-card", useBoardInstance());

  return (
    <section className="at-card at-card-items" aria-labelledby={domId}>
      <div className="at-card-head">
        {/* grip 是装饰层（`pointer-events: none`），与其余卡一致：卡头整条是拖拽热区 */}
        <span className="at-card-grip" aria-hidden="true" />
        <h2 id={domId} className="at-card-title">{title}</h2>
        <span className="at-card-head-right">{controls}</span>
      </div>

      <div className="at-card-items__upper">
        <TodosZone todosModel={todosModel} refreshError={refreshError} />
      </div>

      {/* 贯穿卡宽的浅横线：**卡的直接子节点**，两区都在它之外 → 滚谁都不动它（P1-1） */}
      <div className="at-card-items__divider" role="separator" aria-label={copy.itemsDividerLabel} />

      <div className="at-card-items__lower">
        <TimelineZone
          items={todayItems.rows}
          total={todayItems.total}
          status={todayItems.status}
          onRetry={todayItems.retry}
        />
      </div>
    </section>
  );
}
