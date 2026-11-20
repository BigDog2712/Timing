/**
 * 「事项管理」卡（0.12.6）—— **全新独立卡**，只装配卡头 + `ItemsManageZone`。
 *
 * ```
 * ┌─ 事项管理 ──────────────────────────── ⋯ ─┐
 * │ 事项管理    [新增][事项管理][AI 分类]      │   ← 区标题 + 三动作（常驻，四态之外）
 * │ 常用事项                                  │
 * │  写周报      1h20m  🔗  ●                 │   ← 行点击编辑；行尾圆点起停
 * │ 历史事项                                  │
 * │  记账        25m        ○                 │
 * └──────────────────────────────────────────┘
 * ```
 *
 * 为什么不带"时间"：这个卡管的是**事项本身**（名称、常用/历史、绑定、标签），
 * 时间由计时器与时间线负责。卡上唯一的动手动作是行尾那颗状态圆点。
 *
 * 卡头**没有**「编辑事项」：点行已经是编辑，再放一颗只会让用户多记一条重复路径。
 *
 * 起停与提示条是**配套**的（成败只在宿主确认后由 toast 报出来，见
 * `hooks/useItemTimerToggle.ts`），所以打成一个 `actions` 对象传，分成两个 props
 * 就会出现"传了 timer 没传 toast"的半截装配。
 */
import type { ReactNode } from "react";

import type { ToastPush } from "../../../shared/types/toast.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import { IDLE_ITEM_TIMER, type ItemTimerToggle } from "../hooks/useItemTimerToggle.ts";
import type { TodayItemsState } from "../hooks/useTodayItems.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";
import ItemsManageZone from "./ItemsManageZone.tsx";

/** 本卡用到的今日事项切片：只读 + 两个"已发出先本地生效"的回执。 */
export type ManageCardModel = Pick<TodayItemsState, "rows" | "applyLocalRename" | "applyLocalCreate">;

/** 卡内对外动作：行点击起停（`useItemTimerToggle`）+ 提示条出口（`AppShell.pushToast`）。 */
export interface ManageCardActions {
  itemTimer: ItemTimerToggle;
  onToast: ToastPush;
}

/** 没有调用方接的时候用（卡片单测 / 孤立渲染）：行仍可聚焦可读，点了不改数据、也不出声。 */
export const NO_MANAGE_ACTIONS: ManageCardActions = {
  itemTimer: IDLE_ITEM_TIMER,
  onToast: (): void => undefined,
};

interface Props {
  /** 卡头标题（`displayTitle(card, cardLabels)` 的结果：改名后跟着变） */
  title: string;
  /** 卡头右侧的布局工具条（上移/切档/移除，由布局层注入） */
  controls?: ReactNode;
  /** 今日事项（行上的"今日累计"与"编辑事项"的候选都从这里来） */
  todayItems: ManageCardModel;
  /** 未完成待办：同名事项的行尾圆点画成黄色（缺省 = 没有黄点） */
  todos?: readonly TodoSummary[];
  /** 行尾圆点起停 + 卡内提示条（缺省 = 空实现，见 `NO_MANAGE_ACTIONS`） */
  actions?: ManageCardActions;
}

export default function ManageCard({
  title,
  controls,
  todayItems,
  todos,
  actions = NO_MANAGE_ACTIONS,
}: Props) {
  const domId = withInstance("t-manage-card", useBoardInstance());

  return (
    <section className="at-card at-card-manage" aria-labelledby={domId}>
      <div className="at-card-head">
        <span className="at-card-grip" aria-hidden="true" />
        <h2 id={domId} className="at-card-title">{title}</h2>
        <span className="at-card-head-right">{controls}</span>
      </div>

      {/* 本卡只有一个区：`at-card-manage__body` 负责吃掉卡身余下的高度，区自己滚 */}
      <div className="at-card-manage__body">
        <ItemsManageZone
          todayRows={todayItems.rows}
          todos={todos}
          itemTimer={actions.itemTimer}
          onToast={actions.onToast}
          onLocalRename={todayItems.applyLocalRename}
          onLocalCreate={todayItems.applyLocalCreate}
        />
      </div>
    </section>
  );
}
