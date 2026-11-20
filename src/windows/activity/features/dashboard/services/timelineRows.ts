/**
 * 今日时间线的**纯函数层**（0.12.6 从 `components/TimelineCard.tsx` 原样搬出）。
 *
 * 为什么搬：`TimelineCard` / `TodosModule` 两张卡合并成一张「事项」卡（`ItemsCard`），
 * 卡壳文件下线；但这一层是**判据**（"时间线上算一回事"的唯一定义、行的三列怎么来），
 * 搬进服务层之后新的下区组件与既有单测（`TimelineCard.test.ts` 改 import 路径即可）
 * 共用同一份实现 —— 删卡壳不删测试。
 *
 * 三条口径（与搬家前逐字一致，别在这里"顺手优化"）：
 *   · `startLabel` = 今天**第一段**的开始钟点（09:00），不是聚合窗口；
 *   · `endLabel`   = 今天**最后一段**的结束钟点；`lastEnd === null`（还有一段在跑）
 *     → 显示**此刻**钟点并置 `running`（止列空白会被当成数据坏了）；
 *   · 排序按第一段开始升序；名字/时长来自 items + time_records 聚合，
 *     不是应用窗口标题。
 */
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import { formatDashboardDuration } from "./dashboardFormatting.ts";

export interface TimelineRow {
  key: string;
  /** 事项名 */
  label: string;
  /** 第一段的开始钟点（`09:00`） */
  startLabel: string;
  /** 最后一段的结束钟点；进行中 = 此刻钟点（`buildTimelineRows` 用 `nowMs` 折算） */
  endLabel: string;
  /** `lastEnd === null`（还有一段在跑）——行上用 `timelineNoEnd` 标注 */
  running: boolean;
  /** 事项名下那行的总用时（已格式化） */
  duration: string;
  value: number;
}

function clockOf(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * 时间线上「算一回事」的判据：真的计过时（`value > 0`）、有可用的第一段开始时刻、
 * 名字非空。`buildTimelineRows`（画几行）与 `todayTimedItemIds`（能编辑哪些）
 * **共用这一份** —— 两处各写一遍条件，某天只改了一处，就会变成
 * 「卡上看得见、编辑弹层里找不到」。
 */
export function isTimelineItem(item: TodayItemRow): boolean {
  return item.value > 0 && Number.isFinite(item.firstStart) && item.name.trim().length > 0;
}

/** 纯函数：事项行 → 时序行（导出是为了能单测，渲染层不该是判据唯一证人）。 */
export function buildTimelineRows(
  items: readonly TodayItemRow[],
  limit: number,
  nowMs: number = Date.now(),
): TimelineRow[] {
  return items
    .filter(isTimelineItem)
    .slice()
    .sort((a, b) => a.firstStart - b.firstStart)
    .slice(0, limit)
    .map((item) => ({
      key: `${item.itemId}`,
      label: item.name,
      startLabel: clockOf(item.firstStart),
      /* 「止」= 今天最后一段的结束；进行中显示**此刻**（V-1.6b），不是空白 */
      endLabel: clockOf(item.lastEnd ?? nowMs),
      running: item.lastEnd === null,
      duration: formatDashboardDuration(item.value),
      value: item.value,
    }));
}

/**
 * 「编辑事项」的候选 = **今日时间线上的事项**（按第一段开始时刻升序），
 * **不受档位行数限制**。
 *
 * 主人口径（2026-11-14）：「编辑事项指对今日时间线上的事项进行编辑」。
 * 候选取的**不是**全部 `items`（按 `updatedAt` 倒序）—— 那样列表里会混着半年前建的
 * 「测试」「测试2」；用户要改的是今天做过的那几件。卡上只画得下几行，第 9 件今天也
 * 计时过，它同样该能编辑，所以这里按"今天计过时"筛，而不是按"画出来的行"筛。
 */
export function todayTimedItemIds(items: readonly TodayItemRow[]): number[] {
  return items
    .filter(isTimelineItem)
    .slice()
    .sort((a, b) => a.firstStart - b.firstStart)
    .map((item) => item.itemId);
}
