/**
 * 模块 · 今日活动趋势（今天每小时总时长）。
 *
 * 主人口径（本轮）：「活动趋势」→「今日活动趋势」，只看今天。四条结构照旧、内容换代：
 *   · **每根柱一小时**，从 0 点到当前这一小时（窗口由 `services/trendDays` 算好）；
 *   · **只标三处 x 轴文字**：首、中、末。24 根柱每根都挂字，窄卡里那行字会糊成一片 ——
 *     早先 14 根时就踩过这条，24 根只会更糟；
 *   · 柱高仍按**峰值归一**（不是按 1 小时）：一天里最忙那小时占满，其余按比例。
 *     按 1 小时归一的话，只在某个小时忙 20 分钟的人，每根柱都不到三分之一高；
 *   · 顶部两行读数换成「今日总时长 + 峰值时刻」——"日均"对一天之内没有意义。
 */
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import type { TrendDay } from "../services/trendDays.ts";
import type { TrendState } from "../hooks/useTrendDays.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  controls?: ReactNode;
  model: TrendState;
}

export default function TrendModule({ controls, model }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const UI_TEXT = useLocaleText();

  const windows = model.days;
  const total = windows.reduce((sum, window) => sum + window.durationMs, 0);
  const state = moduleState(model.status, false, total === 0);
  const peak = windows.reduce((max, window) => Math.max(max, window.durationMs), 0);
  /* 峰值时刻 = 最长那根柱的起点。全 0 时没有峰值，读数整段不渲染 —— 写「峰值 00:00 · 0m」
     是在报告一个不存在的事实。 */
  const peakWindow = windows.reduce<TrendDay | null>(
    (best, window) => (window.durationMs > (best?.durationMs ?? 0) ? window : best),
    null,
  );
  const peakLabel = peakWindow && peak > 0
    ? `${formatClockHour(peakWindow.startMs, locale)} · ${formatDashboardDuration(peakWindow.durationMs)}`
    : null;

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
    >
      <div className="qp-trend-head">
        <span>{copy.trendTotal(formatDashboardDuration(total))}</span>
        {peakLabel ? <span>{copy.trendPeak(peakLabel)}</span> : null}
      </div>

      {/* 基线（`trend.rs:52-55`）用 `::after` 画在 `.qp-trend` 上 —— `ul` 里塞别的元素是
          非法结构，而这条线本来也没有语义。日均虚线随"日均"读数一起下线：一条没有基准的
          虚线比不画它更让人费解。 */}
      <ul
        className="qp-trend"
        /* 属性名沿用 `data-trend-days`（QA 脚本/截图契约里就是它），**语义已换成「窗口数」**：
           现在一个窗口是一小时，不再是一天。 */
        data-trend-days={windows.length}
        style={{ "--qp-trend-n": windows.length } as CSSProperties}
      >
        {windows.map((window, index) => {
          /* 最后一根就是"当前这一小时"：它是唯一还在长的柱，用强调色标出来 */
          const isNow = index === windows.length - 1;
          /* 只在首 / 中 / 末三处写字（`trend.rs:110` 的同一判据）。 */
          const showLabel = index === 0 || index === windows.length >> 1 || index === windows.length - 1;
          const hour = new Date(window.startMs).getHours();
          const label = isNow
            ? copy.trendToday
            : copy.trendHourTick(hour);
          const height = peak > 0 ? Math.round((window.durationMs / peak) * 100) : 0;
          /* tooltip 一律给「几点到几点」：轴文字只能放三个，把范围说清是 tooltip 的职责。
             末窗口的右端是"此刻"而不是整点 —— 所以它写的是 `14:00–14:37`，这是真的。 */
          const slot = `${formatClockHour(window.startMs, locale)}–${formatClockHour(window.endMs, locale)}`;
          return (
            <li
              key={window.key}
              className={`qp-trend__day${isNow ? " is-today" : ""}`}
              data-duration={window.durationMs}
              data-empty={window.durationMs > 0 ? undefined : "1"}
            >
              <span
                className="qp-trend__bar"
                /* 有量但极小的小时至少 3px（`trend.rs:82` 的 `.max(3.0)`）：0 高等于
                   "这个小时没用过"，是假话。真为 0 的留下 2px 底桩（exe 是 1.5，取整到 2）。 */
                style={{
                  height: window.durationMs > 0 ? `max(${Math.max(height, 4)}%, 3px)` : "2px",
                }}
                title={copy.trendBar(slot, formatDashboardDuration(window.durationMs))}
              />
              <span className="qp-trend__label">{showLabel ? label : ""}</span>
            </li>
          );
        })}
      </ul>
    </ModuleShell>
  );
}

/**
 * 本地整点的 24 小时制文字（tooltip 与峰值时刻用）：`09:00`。
 *
 * 用 `hourCycle: "h23"` 而不是 `hour12: false`：后者在部分 ICU 版本里把零点写成 `24:00`，
 * 于是"23:00–24:00"和"24:00–01:00"会同时出现在轴上。
 */
function formatClockHour(at: number, locale: string): string {
  const date = new Date(at);
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}
