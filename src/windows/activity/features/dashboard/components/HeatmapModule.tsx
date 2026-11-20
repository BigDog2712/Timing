/**
 * 模块 · 活动热力图（一个月一页：横轴日期，纵轴「day」合计 + 6 个四小时段）。
 *
 * [2026-11-20] 主人口径：把"周几 × 小时"的平均作息图换成**按天**的热力 ——
 *   纵轴：最上面一行「day」（当天合计），下面是 0 / 4 / 8 / 12 / 16 / 20 六个时段起点；
 *   横轴：整月每一天一列（28–31 列都铺满，可横向滚动），日期数字每 5 天标一次
 *   （1、5、10、15…），其余留空；月导航回看历史月份。
 *
 * 三个刻意的取舍：
 *   · 格子 `aria-hidden`，整张图是一个 `role="img"` + 一句摘要 —— 一个月近 200 格
 *     逐个念对读屏是灾难；
 *   · 两个分母：6 个时段行按**时段峰值**着色，合计行按**日峰值**着色。合计是时段的
 *     数倍，共用分母会让合计行永远满格、时段行永远最浅；
 *   · 今天还没到的时段、还没到的天画成 `data-future` 的空底（不是零活动）—— "还没到"
 *     与"没干活"在数据上是两件事，颜色不能一样。
 */
import { Fragment, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

import QuietRangeControl from "../../../shared/components/QuietRangeControl.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import {
  heatmapLevel,
  peakHeatmapDay,
  HEATMAP_BUCKET_HOURS,
  HEATMAP_BUCKETS,
  type HeatmapDay,
} from "../services/heatmapDays.ts";
import { HEATMAP_COPY } from "../heatmapCopy.ts";
import type { HeatmapState } from "../hooks/useHeatmapModel.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";

interface Props {
  controls?: ReactNode;
  /** 整个状态（含 `retry` / 月导航）：壳的 E2 重试键与卡头的翻月都要用 */
  state: HeatmapState;
}

/** 图例 5 格（与色阶 1–5 一一对应） */
const LEGEND_LEVELS = [1, 2, 3, 4, 5] as const;
/** 纵轴只写时段起点（那一列只有 34px，写区间会挤成两行） */
const BUCKET_STARTS = Array.from({ length: HEATMAP_BUCKETS }, (_, bucket) =>
  String(bucket * HEATMAP_BUCKET_HOURS),
);
/** 悬浮说明仍写完整区间（`0–4` …） */
const BUCKET_RANGES = Array.from({ length: HEATMAP_BUCKETS }, (_, bucket) => {
  const from = bucket * HEATMAP_BUCKET_HOURS;
  return `${from}–${from + HEATMAP_BUCKET_HOURS}`;
});
/** 横轴日期每 5 天标一次：1、5、10、15…（其余数字留空，别挤在一起） */
function showsDateLabel(dayOfMonth: number): boolean {
  return dayOfMonth === 1 || dayOfMonth % 5 === 0;
}

function formatDayLabel(ms: number, locale: string, withYear = false): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...(withYear ? { year: "numeric" as const } : {}),
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

function formatMonthLabel(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export default function HeatmapModule({ controls, state: heat }: Props) {
  const locale = useLocale();
  const UI_TEXT = useLocaleText();
  const copy = HEATMAP_COPY[locale];
  const { days, bucketMaxMs, totalMaxMs, monthTotalMs } = heat.model;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const state = moduleState(heat.status, false, totalMaxMs <= 0);
  const monthLabel = formatMonthLabel(heat.monthStartMs, locale);
  const peak = peakHeatmapDay(heat.model);
  const peakText = peak ? formatDayLabel(peak.day.startMs, locale) : null;
  const summary = copy.summary(monthLabel, formatDashboardDuration(monthTotalMs), peakText);
  const dayLabels = useMemo(
    () => days.map((day) => formatDayLabel(day.startMs, locale, true)),
    [days, locale],
  );

  /* 打开就停到今天的列：整月铺满后最右是"还没到的天"，直接甩到末端等于看未来。
   * 当前月让今天贴右缘（内容不够宽时自然停在 0，从 1 号看起）；历史月份才滚到月末。 */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const todayKey = formatLocalDateKey(new Date());
    const today = days.find((day) => day.key === todayKey);
    const node = today
      ? element.querySelector<HTMLElement>(`[data-date="${today.key}"][data-bucket="0"]`)
      : null;
    if (!node) {
      element.scrollLeft = element.scrollWidth;
      return;
    }
    const grid = node.closest<HTMLElement>(".at-heatmap__grid");
    if (!grid) return;
    const desired = node.getBoundingClientRect().right - grid.getBoundingClientRect().left - element.clientWidth;
    element.scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, desired));
  }, [days]);

  const cellLevel = (day: HeatmapDay, bucket: number): string => {
    if (day.futureBuckets.includes(bucket)) return "future";
    return String(heatmapLevel(day.buckets[bucket], bucketMaxMs));
  };

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
      meta={totalMaxMs > 0 ? copy.meta(formatDashboardDuration(monthTotalMs)) : undefined}
      subhead={(
        <div className="at-heatmap-range">
          <QuietRangeControl
            ariaLabel={copy.rangeLabel}
            label={monthLabel}
            previousAriaLabel={copy.previousMonth}
            nextAriaLabel={copy.nextMonth}
            previousDisabled={false}
            nextDisabled={!heat.canGoNext}
            onPrevious={heat.goPrevious}
            onNext={heat.goNext}
          />
        </div>
      )}
    >
      <div className="at-heatmap">
        <div className="at-heatmap__frame">
          <div className="at-heatmap__labels" aria-hidden="true">
            <span className="at-heatmap__labels-corner" />
            <span className="at-heatmap__bucket-label at-heatmap__bucket-label--total">{copy.totalRow}</span>
            {BUCKET_STARTS.map((start) => (
              <span key={start} className="at-heatmap__bucket-label">{start}</span>
            ))}
          </div>

          <div className="at-heatmap__scroll at-scroll-region" ref={scrollRef}>
            <div
              className="at-heatmap__grid"
              role="img"
              aria-label={summary}
              style={{ "--at-heatmap-days": Math.max(1, days.length) } as CSSProperties}
            >
              {days.map((day) => (
                <span key={`d:${day.key}`} className="at-heatmap__date" data-date={day.key}>
                  {showsDateLabel(day.dayOfMonth) ? day.dayOfMonth : ""}
                </span>
              ))}

              {days.map((day, index) => {
                const isFutureDay = day.futureBuckets.length === HEATMAP_BUCKETS;
                const level = heatmapLevel(day.totalMs, totalMaxMs);
                return (
                  <span
                    key={`t:${day.key}`}
                    className="at-heatmap__cell at-heatmap__cell--total"
                    data-date={day.key}
                    data-level={isFutureDay ? undefined : level}
                    data-future={isFutureDay ? "true" : undefined}
                    title={isFutureDay
                      ? undefined
                      : copy.totalCell(dayLabels[index], formatDashboardDuration(day.totalMs))}
                  />
                );
              })}

              {BUCKET_RANGES.map((range, bucket) => (
                <Fragment key={range}>
                  {days.map((day, index) => {
                    const level = cellLevel(day, bucket);
                    return (
                      <span
                        key={`b:${day.key}:${bucket}`}
                        className="at-heatmap__cell"
                        data-date={day.key}
                        data-bucket={bucket}
                        data-level={level === "future" ? undefined : level}
                        data-future={level === "future" ? "true" : undefined}
                        title={level === "future"
                          ? undefined
                          : copy.cell(dayLabels[index], range, formatDashboardDuration(day.buckets[bucket]))}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        <div className="at-heatmap__foot" aria-hidden="true">
          <span className="at-heatmap__legend">
            {copy.legendLow}
            {LEGEND_LEVELS.map((level) => <i key={level} data-level={level} />)}
            {copy.legendHigh}
          </span>
        </div>
      </div>
    </ModuleShell>
  );
}