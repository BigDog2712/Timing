/**
 * 模块 · 活动热力图（近 4 周的平均作息：周一→周日 7 行 × 24 列）。
 *
 * 口径与 Rust 版 `widgets/heatmap.rs` 一致 —— 主人认可的正是那个效果：
 *   行是**固定的星期几**（不是滚动 7 天，"周一那一行"每周都对得上），
 *   颜色按**窗口峰值开方**分 5 档（活动分布长尾很重，线性映射会让满屏都是最浅一档）。
 *
 * 三个刻意的取舍：
 *   · 格子 `aria-hidden`，整张图是一个 `role="img"` + 一句摘要 —— 168 个格子逐个念
 *     对读屏是灾难，而"周几几点最忙"已经由摘要代表；
 *   · 零活动格用 `--qp-surface-raise`（比卡面亮一档），**不是透明**：看不见的格子会让
 *     "这天只有几个小时"变成假话；
 *   · 图例按卡片高度取舍（容器查询），S 档只有 ~110px 可用高，塞图例会把最后一行挤掉。
 */
import { Fragment } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration, formatWeekdayNarrow, formatWeekdayShort } from "../services/dashboardFormatting.ts";
import { heatmapLevel, peakHeatmapCell } from "../services/heatmapDays.ts";
import { HEATMAP_COPY } from "../heatmapCopy.ts";
import type { HeatmapState } from "../hooks/useHeatmapModel.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";

interface Props {
  controls?: ReactNode;
  /** 整个状态（含 `retry`）：壳的 E2 重试键要用，所以不拆成 `model` 一个字段 */
  state: HeatmapState;
}

/** 刻度只标 4 个整点：24 个数字在 518 宽里会连成一片，反而看不出"哪一段" */
const HOUR_TICKS = [0, 6, 12, 18];
/** 图例 5 格（与色阶 1–5 一一对应） */
const LEGEND_LEVELS = [1, 2, 3, 4, 5] as const;

export default function HeatmapModule({ controls, state: heat }: Props) {
  const locale = useLocale();
  const UI_TEXT = useLocaleText();
  const copy = HEATMAP_COPY[locale];
  const { rows, maxMs, weeklyTotalMs, weeks } = heat.model;

  const state = moduleState(heat.status, false, maxMs <= 0);
  const peak = peakHeatmapCell(heat.model);
  const peakText = peak
    ? copy.peakCell(formatWeekdayShort(rows[peak.weekday].sampleStartMs, locale), peak.hour)
    : null;

  return (
    <ModuleShell
      controls={controls}
      id="t-heatmap"
      title={copy.title}
      state={state}
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={heat.retry}
      emptyText={copy.empty}
      skeletonRows={7}
      skeletonRow="app"
      meta={maxMs > 0 ? copy.meta(weeks) : undefined}
    >
      <div
        className="qp-heatmap"
        role="img"
        aria-label={copy.summary(weeks, formatDashboardDuration(weeklyTotalMs), peakText)}
      >
        <div className="qp-heatmap__rows" aria-hidden="true">
          {rows.map((row) => {
            /* 行标用**窄名**（「一」而不是「周一」）：这一列只有 16px，与 `heatmap.rs:28`
             * 的 `label_w` 同宽，用短名会被省略成「周…」。 */
            const label = formatWeekdayNarrow(row.sampleStartMs, locale);
            const full = formatWeekdayShort(row.sampleStartMs, locale);
            return (
              <Fragment key={row.weekday}>
                <span className="qp-heatmap__day" title={full}>{label}</span>
                <span className="qp-heatmap__cells">
                  {row.cells.map((ms, hour) => {
                    const level = heatmapLevel(ms, maxMs);
                    return (
                      <span
                        key={hour}
                        className="qp-heatmap__cell"
                        data-level={level}
                        title={level > 0 ? copy.cell(full, hour, formatDashboardDuration(ms)) : undefined}
                      />
                    );
                  })}
                </span>
              </Fragment>
            );
          })}
        </div>

        <div className="qp-heatmap__foot" aria-hidden="true">
          <span className="qp-heatmap__axis">
            {HOUR_TICKS.map((hour) => (
              <span key={hour} style={{ gridColumn: hour + 1 }}>{hour}</span>
            ))}
          </span>
          <span className="qp-heatmap__legend">
            {copy.legendLow}
            {LEGEND_LEVELS.map((level) => <i key={level} data-level={level} />)}
            {copy.legendHigh}
          </span>
        </div>
      </div>
    </ModuleShell>
  );
}
