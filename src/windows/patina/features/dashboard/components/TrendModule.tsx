/**
 * 模块 · 今日活动趋势（今天每小时总时长）。
 *
 * 主人口径（本轮 0.13 · 1.5）：**横轴铺满 24 个整点桶（00:00–24:00）**，不再随时刻伸缩：
 *   · 桶由 `services/trendDays.buildTodayTrendPlan` 给好（未来桶时长恒 0）；
 *   · **轴字只落 5 处**：`00:00 / 06:00 / 12:00 / 18:00 / 24:00`（判据：轴字数量 = 5
 *     且首字为 00:00）。24 根柱每根都挂字，窄卡里那行字会糊成一片；
 *   · **"当前这一桶" = 覆盖 now 的那一桶**（`model.nowMs` 落在哪格就标哪格），
 *     不再是"最后一桶"—— 最后一桶永远是 23:00，那是明天的事；
 *   · 柱高仍按**峰值归一**（不是按 1 小时）：一天里最忙那小时占满，其余按比例；
 *   · 顶部两行读数仍是「今日总时长 + 峰值时刻」。
 */
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import type { TrendDay } from "../services/trendDays.ts";
import type { TrendState } from "../hooks/useTrendDays.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  /** 卡头 `⋯`（布局层的 controls 注入，`DashboardCards` 统一给） */
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
          非法结构，而这条线本来也没有语义。 */}
      <ul
        className="qp-trend"
        /* 属性名沿用 `data-trend-days`（QA 脚本/截图契约里就是它），**语义是「展示桶数」**：
           正常日恒 24（DST 前跳日少一格 —— 那一小时本地不存在）。 */
        data-trend-days={windows.length}
        style={{ "--qp-trend-n": windows.length } as CSSProperties}
      >
        {windows.map((window, index) => {
          /* 覆盖 now 的那一桶 = 唯一还在长的柱，用强调色标出来（不是"最后一桶"） */
          const isNow = model.nowMs >= window.startMs && model.nowMs < window.endMs;
          /* 轴字 5 处：起点落在 0/6/12/18 的桶写整点，末桶写 24:00（轴的右端点）。
             isLast 必须按下标判 —— `window.endMs > 最后桶.endMs` 对最后桶自己是
             false，末桶会永远拿不到轴字（tr05 判据钉着这个坑）。 */
          const startHour = new Date(window.startMs).getHours();
          const isLast = index === windows.length - 1;
          const showLabel = startHour % 6 === 0 || isLast;
          const label = isLast
            ? "24:00"
            : formatClockHour(window.startMs, locale);
          const height = peak > 0 ? Math.round((window.durationMs / peak) * 100) : 0;
          /* tooltip 一律给「几点到几点」：轴文字只能放五处，把范围说清是 tooltip 的职责。
             末桶的右端是次日 0 点，写 "00:00" 会和首桶混淆 —— 轴上它叫 24:00。
             未来桶的 tooltip 也是真话 —— "还没有发生"。 */
          const slot = isLast
            ? `${formatClockHour(window.startMs, locale)}–24:00`
            : `${formatClockHour(window.startMs, locale)}–${formatClockHour(window.endMs, locale)}`;
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
 * 本地整点的 24 小时制文字（轴字与峰值时刻用）：`09:00`。
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
