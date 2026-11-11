import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import { formatDateLabel } from "../services/historyFormatting.ts";
import type { HistoryRangeAggregate } from "../services/historyRangeAggregate.ts";
import type { HistoryRangeCopy } from "../rangeCopy.ts";

/**
 * 区间视图第一块：四格摘要 + 逐日柱。
 *
 * 逐日柱是**入口**不是装饰：点任一根 = 跳那天的单日时间轴（`onOpenDay`）。
 * 所以它必须是 `<button>`、必须有 `aria-label`（"查看 11月10日 的单日记录（3 小时 12 分）"），
 * 并且空日也允许点——"这天为什么是空的"本身就是要去看一眼的问题。
 *
 * 柱高按区间内最大值归一，最小 2px：30 天里只有一天有数据时，
 * 其余 29 天的 2px 是"确实没有"与"渲染失败"的分界线。
 */
interface Props {
  aggregate: HistoryRangeAggregate;
  copy: HistoryRangeCopy;
  uiText: UiText;
  locale: Locale;
  onOpenDay: (dateKey: string) => void;
  /**
   * 逐日柱是否显示。单日档（`dayCount === 1`）传 `false`：一根柱子既不表达趋势，
   * 自己点自己也没有意义 —— 单日与区间共用这张摘要卡，区别只在这里。
   */
  showDailyBars?: boolean;
}

const BAR_MAX_HEIGHT_PX = 64;
const BAR_MIN_HEIGHT_PX = 2;

export default function HistoryRangeSummary({
  aggregate,
  copy,
  uiText,
  locale,
  onOpenDay,
  showDailyBars = true,
}: Props) {
  const days = aggregate.days;
  const peakMs = days.reduce((max, day) => Math.max(max, day.appMs), 0);
  const labelStep = Math.max(1, Math.ceil(days.length / 6));
  const metrics = [
    { key: "activity", label: copy.summaryActivity, value: formatDuration(aggregate.activityMs) },
    { key: "timing", label: copy.summaryTiming, value: formatDuration(aggregate.timingMs) },
    { key: "notes", label: copy.summaryNotes, value: String(aggregate.noteCount) },
    { key: "todos", label: copy.summaryTodos, value: String(aggregate.todoDoneCount) },
  ];

  return (
    <section className="qp-panel p-5 history-range-summary" data-history-range-summary>
      <div className="history-range-summary-metrics">
        {metrics.map((metric) => (
          <div key={metric.key} className="history-range-summary-metric" data-history-range-metric={metric.key}>
            <span className="history-range-summary-metric-label">{metric.label}</span>
            <span className="history-range-summary-metric-value">{metric.value}</span>
          </div>
        ))}
      </div>

      {showDailyBars ? (
        <div className="history-range-daily">
          <div className="history-range-daily-head">
            <h3 className="history-range-daily-title">{copy.dailyTitle}</h3>
            <span className="history-range-daily-hint">{copy.dailyHint}</span>
          </div>
          <div className="history-range-daily-bars" data-history-range-days={days.length}>
          {days.map((day, index) => {
            const heightPx = peakMs > 0
              ? Math.max(BAR_MIN_HEIGHT_PX, Math.round((day.appMs / peakMs) * BAR_MAX_HEIGHT_PX))
              : BAR_MIN_HEIGHT_PX;
            const dateLabel = formatDateLabel(new Date(day.startMs), uiText, locale);
            const showLabel = index === 0 || index === days.length - 1 || index % labelStep === 0;
            return (
              <button
                key={day.dateKey}
                type="button"
                className="history-range-daily-bar"
                data-history-range-day={day.dateKey}
                data-empty={day.appMs > 0 ? undefined : "true"}
                title={copy.openDay(dateLabel, formatDuration(day.appMs))}
                aria-label={copy.openDay(dateLabel, formatDuration(day.appMs))}
                onClick={() => onOpenDay(day.dateKey)}
              >
                <span className="history-range-daily-bar-track">
                  <span
                    className="history-range-daily-bar-fill"
                    style={{ height: `${heightPx}px` }}
                  />
                </span>
                <span className="history-range-daily-bar-label">
                  {showLabel ? day.dateKey.slice(5) : ""}
                </span>
              </button>
            );
          })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
