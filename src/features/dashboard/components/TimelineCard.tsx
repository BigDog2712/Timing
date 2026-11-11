/**
 * [P3 · 0.12.1] 事项菜单卡：今日**按时序**的只读列表。
 *
 * 三条克制，先写清楚免得以後被当成缺陷：
 * 1. **只读**。编辑要点进事项菜单（P4 才补写面），这里不做就地编辑 —— 一个「看着能改、
 *    改了不生效」的行比不能改更糟。
 * 2. 数据源是**分析窗已有的 `compiledSessions`**，不新增宿主命令。所以行里显示的是
 *    「窗口标题 / 应用 + 起止」，不是 `items` 表的事项名（两者同名不同源，见 focusDimension.ts 头注释）。
 * 3. `displayTitle` 为空时回落 `displayName`，再空就不进列表（不画一行空白）。
 *
 * 与提醒卡的关系（D1 的硬判据）：提醒的调度在 Rust（`jobs::reminder` 15s 扫描 +
 * `jobs::nudge`），**与这张卡毫无关系**——移除卡片不会停掉任何提醒。这条是只读卡的
 * 前提，不是巧合，已在任务书里留证。
 */
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { CardTier } from "../layout/contract.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import type { ReactNode } from "react";

/** 档位 → 可见行数。S/M/L 与三档卡高对齐（S 少两行、L 多两行）。 */
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
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 纯函数：会话 → 行。导出是为了能单测（渲染层不该是判据的唯一证人口）。 */
export function buildTimelineRows(sessions: readonly CompiledSession[], limit: number): TimelineRow[] {
  const rows = sessions
    .filter((session) => Number.isFinite(session.startTime))
    .map((session) => {
      const label = (session.displayTitle || session.displayName || "").trim();
      const fallbackEnd = session.endTime ?? session.startTime;
      const duration = Math.max(0, session.duration ?? fallbackEnd - session.startTime);
      return { session, label, duration };
    })
    .filter((entry) => entry.label.length > 0 && entry.duration > 0)
    .sort((a, b) => a.session.startTime - b.session.startTime)
    .slice(0, limit);

  return rows.map((entry, index) => ({
    key: `${entry.session.startTime}:${entry.label}:${index}`,
    time: clockOf(entry.session.startTime),
    label: entry.label,
    duration: formatDashboardDuration(entry.duration),
    value: entry.duration,
  }));
}

interface Props {
  controls?: ReactNode;
  sessions: readonly CompiledSession[];
  tier: CardTier;
  status: LoadStatus;
  refreshError: boolean;
  onRetry: () => void;
}

export default function TimelineCard({ controls, sessions, tier, status, refreshError, onRetry }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const rows = buildTimelineRows(sessions, ROWS_BY_TIER[tier]);
  const state = moduleState(status, refreshError, rows.length === 0);

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
      emptyText={copy.itemsEmpty}
      meta={copy.itemsCount(rows.length)}
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
