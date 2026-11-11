/**
 * 模块 · 应用趋势（近 7 天每日总时长）。
 *
 * 与历史页的「逐日柱」同一份数据（`cmd_get_activity_aggregate_range` + 逐日桶边界），
 * 只是这里把七根柱压进一张卡：主界面要的是"这周是不是在往上走"，不是精确读数。
 *
 * 柱高按**峰值归一**而不是按 24 小时归一：一天最多用 8 小时的人，按 24 小时算每根柱都只有
 * 三分之一高，看不出起伏。峰值归一后最高那根吃满，比较的是「谁比谁长」。
 */
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import type { TrendState } from "../hooks/useTrendDays.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";

interface Props {
  controls?: ReactNode;
  model: TrendState;
}

function weekdayLabel(startMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(startMs));
  } catch {
    return new Date(startMs).toLocaleDateString();
  }
}

export default function TrendModule({ controls, model }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const UI_TEXT = useLocaleText();

  const total = model.days.reduce((sum, day) => sum + day.durationMs, 0);
  const state = moduleState(model.status, false, total === 0);
  const peak = model.days.reduce((max, day) => Math.max(max, day.durationMs), 0);
  const todayKey = model.days.length > 0 ? model.days[model.days.length - 1].key : null;

  return (
    <ModuleShell
      controls={controls}
      id="t-trend"
      title={copy.trendTitle}
      state={state}
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={model.retry}
      emptyText={copy.trendEmpty}
      meta={total > 0 ? copy.trendTotal(formatDashboardDuration(total)) : undefined}
    >
      <ul className="qp-trend" data-trend-days={model.days.length}>
        {model.days.map((day) => {
          const label = weekdayLabel(day.startMs, locale);
          const height = peak > 0 ? Math.round((day.durationMs / peak) * 100) : 0;
          return (
            <li
              key={day.key}
              className={`qp-trend__day${day.key === todayKey ? " is-today" : ""}`}
              data-duration={day.durationMs}
            >
              <span
                className="qp-trend__bar"
                /* 有量但极小的那天留 4% 高度：0 高等于"这天没用过"，是假话 */
                style={{ height: `${day.durationMs > 0 ? Math.max(height, 4) : 0}%` }}
                title={copy.trendBar(label, formatDashboardDuration(day.durationMs))}
              />
              <span className="qp-trend__label">{label}</span>
            </li>
          );
        })}
      </ul>
    </ModuleShell>
  );
}
