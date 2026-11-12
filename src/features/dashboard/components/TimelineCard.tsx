/**
 * [P3 修正 · 0.12.1] 事项菜单卡：今日**事项**按时序。
 *
 * 主人口径（2026-11-11）：「事项菜单显示的是悬浮窗内的事项，而非应用的」。
 * 数据源因此从 `CompiledSession`（应用活动）换成 `useTodayItems`（Timing 自己的
 * `items` + `time_records`）——一行一个事项，不再是「哪个应用窗口开过」。
 *
 * 三条克制：
 * 1. **时间线行只读**。新建/管理在卡底那两个入口里（见 `TimelineManage.tsx`：
 *    「＋ 新建事项」= 名称 + 默认时长 + 设为常用；「事项管理」= 常用事项 / 近期事项两组，
 *    行内可就地改名与设时长）；写一律走 `patina:host-intent`，分析窗没有写命令。
 *    行内不做 in-place 编辑 —— 卡高按档位锁死，行里塞输入框会把读数挤成省略号。
 * 2. 一行 = 一个事项：显示**今天的累计**，`时间` 列是该事项今天第一段的开始时刻。
 * 3. 顺序按第一段开始时刻升序（「按时序」的字面意思），不是按累计时长。
 *
 * 与提醒卡的关系（D1 的硬判据）：提醒调度在 Rust（`jobs::reminder` 15s 扫描 +
 * `jobs::nudge`），与这张卡无关 —— 移除卡片不会停掉任何提醒。
 */
import { useState } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { CardTier } from "../layout/contract.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import TimelineManage, { type TimelineManageMode } from "./TimelineManage.tsx";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import type { ReactNode } from "react";

const ROWS_BY_TIER: Record<CardTier, number> = { S: 4, M: 6, L: 8 };

export interface TimelineRow {
  key: string;
  time: string;
  label: string;
  duration: string;
  value: number;
}

function clockOf(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** 纯函数：事项行 → 时序行（导出是为了能单测，渲染层不该是判据唯一证人）。 */
export function buildTimelineRows(items: readonly TodayItemRow[], limit: number): TimelineRow[] {
  return items
    .filter((item) => item.value > 0 && Number.isFinite(item.firstStart) && item.name.trim().length > 0)
    .slice()
    .sort((a, b) => a.firstStart - b.firstStart)
    .slice(0, limit)
    .map((item) => ({
      key: `${item.itemId}`,
      time: clockOf(item.firstStart),
      label: item.name,
      duration: formatDashboardDuration(item.value),
      value: item.value,
    }));
}

interface Props {
  controls?: ReactNode;
  items: readonly TodayItemRow[];
  tier: CardTier;
  status: LoadStatus;
  refreshError: boolean;
  onRetry: () => void;
  /** [本轮] 改名已发出后通知时间线本地先改（`useTodayItems.applyLocalRename`） */
  onLocalRename: (itemId: number, name: string) => void;
  /** [本轮] 新建已发出后通知时间线重拉一次（`useTodayItems.applyLocalCreate`） */
  onLocalCreate: (name: string) => void;
}

export default function TimelineCard({
  controls,
  items,
  tier,
  status,
  refreshError,
  onRetry,
  onLocalRename,
  onLocalCreate,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const rows = buildTimelineRows(items, ROWS_BY_TIER[tier]);
  const state = moduleState(status, refreshError, rows.length === 0);
  /** 两个弹层互斥（同一时刻只可能有一个）：`null` = 都关着。
   *  `"create"` = 新建事项（名称 + 默认时长 + 设为常用）；`"manage"` = 事项管理
   *  （常用事项 / 近期事项两组，行内编辑）—— 不再是上一版的“全表改名”。 */
  const [manage, setManage] = useState<TimelineManageMode>(null);

  return (
    <ModuleShell
      controls={controls}
      id="t-timeline"
      title={copy.cardLabels.timeline}
      className="qp-card-timeline"
      state={state}
      skeletonRows={4}
      skeletonRow="todo"
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={onRetry}
      refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
      emptyText={copy.timerEmpty}
      /* 卡头那颗「更新事项」类入口在药丸侧：这两颗按钮只发意图，行本身只读 */
      action={(
        <span className="qp-timeline-actions">
          <button
            type="button"
            className="qp-link-btn"
            onClick={() => { void emitHostIntent({ action: "open_items_menu" }); }}
          >
            {copy.itemsMenu}
          </button>
          <button
            type="button"
            className="qp-link-btn"
            onClick={() => { void emitHostIntent({ action: "open_common_items" }); }}
          >
            {copy.commonItems}
          </button>
        </span>
      )}
      /* [本轮] 卡底两个写入口放 **footer** 而不是 children：children 只在 ready 渲染，
         而「今天还没有计时」正是最想新建/管理事项的时刻（`ModuleShell` 的 footer 注释）。 */
      footer={(
        <div className="qp-timeline-manage">
          <button type="button" className="qp-link-btn" onClick={() => setManage("create")}>
            {copy.timelineNewItem}
          </button>
          <button type="button" className="qp-link-btn" onClick={() => setManage("manage")}>
            {copy.timelineManageItems}
          </button>
          <TimelineManage
            mode={manage}
            onClose={() => setManage(null)}
            onLocalRename={onLocalRename}
            onLocalCreate={onLocalCreate}
          />
        </div>
      )}
    >
      <ul className="qp-timeline-rows">
        {rows.map((row) => (
          <li key={row.key} className="qp-timeline-row">
            <span className="qp-timeline-time">{row.time}</span>
            <span className="qp-timeline-label" title={row.label}>{row.label}</span>
            <span className="qp-timeline-duration">{row.duration}</span>
          </li>
        ))}
      </ul>
    </ModuleShell>
  );
}
