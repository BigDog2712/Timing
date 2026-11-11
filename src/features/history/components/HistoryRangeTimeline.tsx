import { useMemo } from "react";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import { useActivityDisplayColor } from "../../../shared/hooks/useActivityDisplayColor.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { objectColor } from "../../../shared/classification/objectColor.ts";
import { formatDateLabel, formatTime } from "../services/historyFormatting.ts";
import type { HistoryRangeTimelineLane } from "../services/historyRangeTimeline.ts";
import type { HistoryRangeCopy } from "../rangeCopy.ts";

/**
 * 区间视图的**逐日时间轴**：一行一天，横轴 0–24h。
 *
 * 与单日那根轴的分工：
 *   · 单日轴（`HistoryHorizontalTimeline`）可缩放、可点段、带泳道与图例 —— 那是"研究一天"；
 *   · 这里只回答"这段时间每天都在什么时候忙"，所以每行是一条静止的带子，点行首回单日。
 *
 * 为什么不用 `QuietTimelineSegment`：它每个段挂一个 `QuietTooltip`（带状态与事件），
 * 30 天 × 上百段就是几千个浮层实例，光挂载就够卡。这里的块是纯色条 + 原生 `title`，
 * 定位仍走同一套百分比坐标系（`leftRatio` / `widthRatio`），所以两处看起来是一条血脉。
 *
 * 颜色按**应用键**解析一次（`AppClassification` + `objectColor`，与单日时间轴同一条链路），
 * 同一天里同一应用、以及跨天的同一应用必然是同一个颜色 —— 否则"看色块形状"这件事就不成立。
 */
interface Props {
  copy: HistoryRangeCopy;
  uiText: UiText;
  locale: Locale;
  lanes: HistoryRangeTimelineLane[];
  onOpenDay: (dateKey: string) => void;
}

const AXIS_LABELS = ["00", "06", "12", "18", "24"];

function resolveAppColor(key: string): string {
  const parent = AppClassification.resolveStatisticalApp(key);
  const mapped = AppClassification.mapApp(parent, {});
  const override = AppClassification.getUserOverride(parent)?.color ?? null;
  return objectColor("app", parent, override, undefined, mapped.category, mapped.color);
}

export default function HistoryRangeTimeline({ copy, uiText, locale, lanes, onOpenDay }: Props) {
  const displayColor = useActivityDisplayColor();

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const lane of lanes) {
      for (const block of lane.blocks) {
        if (!map.has(block.key)) {
          map.set(block.key, displayColor(resolveAppColor(block.key), "timeline"));
        }
      }
    }
    return map;
  }, [displayColor, lanes]);

  const hasAnyBlock = lanes.some((lane) => lane.blocks.length > 0);

  return (
    <section className="qp-panel p-5 history-range-timeline" data-history-range-timeline>
      <header className="history-range-card-head">
        <h3 className="history-range-card-title">{copy.timelineTitle}</h3>
        <span className="history-range-card-meta">{copy.timelineHint}</span>
      </header>

      {hasAnyBlock ? (
        <div className="history-range-timeline-body">
          <div className="history-range-timeline-row history-range-timeline-axis" aria-hidden="true">
            <span />
            <span className="history-range-timeline-ticks">
              {AXIS_LABELS.map((label) => <span key={label}>{label}</span>)}
            </span>
          </div>

          {lanes.map((lane) => {
            const first = lane.blocks[0];
            const last = lane.blocks[lane.blocks.length - 1];
            const appCount = new Set(lane.blocks.map((block) => block.key)).size;
            const dateLabel = formatDateLabel(new Date(lane.startMs), uiText, locale);
            const ariaLabel = first && last
              ? copy.timelineLaneAria(
                dateLabel,
                `${formatTime(first.startMs, locale)}–${formatTime(last.endMs, locale)}`,
                appCount,
              )
              /* 空行也得能读：读屏听到的应该是"这天没有记录"，而不是一句空标签 */
              : `${dateLabel} · ${copy.timelineEmpty}`;
            return (
              <div
                key={lane.dateKey}
                className="history-range-timeline-row"
                data-history-range-timeline-day={lane.dateKey}
              >
                <button
                  type="button"
                  className="history-range-timeline-label"
                  title={ariaLabel}
                  aria-label={ariaLabel}
                  onClick={() => onOpenDay(lane.dateKey)}
                >
                  {lane.dateKey.slice(5)}
                </button>
                <span className="history-range-timeline-track" role="img" aria-label={ariaLabel}>
                  {lane.blocks.map((block) => (
                    <span
                      key={`${block.key}:${block.startMs}`}
                      className="history-range-timeline-block"
                      data-history-range-timeline-block={block.key}
                      title={`${formatTime(block.startMs, locale)}–${formatTime(block.endMs, locale)} ${block.label}`}
                      style={{
                        left: `${block.leftRatio * 100}%`,
                        width: `${block.widthRatio * 100}%`,
                        background: colors.get(block.key),
                      }}
                    />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="history-range-empty">{copy.timelineEmpty}</p>
      )}
    </section>
  );
}
