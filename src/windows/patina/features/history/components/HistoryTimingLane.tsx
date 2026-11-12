import { Fragment } from "react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { QuietTimelineTrack } from "../../../shared/components/QuietTimelineTrack.tsx";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import type { HistoryTimelineViewModel } from "../../../shared/lib/activityTimelineCompiler.ts";
import { formatTime } from "../services/historyFormatting.ts";
import { useTimingSegments } from "../hooks/useTimingSegments.ts";

/**
 * 历史页「Timing 计时」泳道（P0-02）：这一天我在 Timing 里计的事，与上方的电脑活动轨
 * **同一天、同一视口、同一坐标**（比例公式见 `services/timingLaneSegments.ts`）。
 *
 * 四条边界：
 *  ① **不取整**：段的位置是毫秒比例，交给 CSS 百分比——任何按分钟取整都会引入 ≥30s
 *     偏差，直接威胁「14:00–14:30 的计时段与同活动段首尾对齐 ≤1 分钟」。
 *  ② **无记录整条不渲染**（连标题都不出现）：没计过的那天不该多出一条空行。
 *  ③ **不自己起定时器**：「现在」只认 `viewModel.visibleEndMs`（FUSION-ARCH-v1 §6.2），
 *     进行中的段右端因此与活动轨的「现在」严格同一条竖线。
 *  ④ 自己渲染段而不复用 `QuietTimelineSegment`：本泳道的视觉（细轨 + 进行中条纹）与
 *     活动轨不同，且 P0-05 的「段可点」只该落在这一条新轨上，不牵连 3 处既有用法。
 *
 * 文案走组件内 `COPY`（`useLocale()`），**不碰 i18n 生成物**——`zh-CN.ts` 是按索引对齐的
 * 位置数组，任何增删都会让其后全部文案错位（B1 先例：`HistoryTimingOverlap.tsx:15-18`）。
 */
const COPY = {
  zh: { title: "Timing 计时", hint: "在 Timing 里计的事", running: "进行中" },
  en: { title: "Timing entries", hint: "Tracked in Timing", running: "In progress" },
} as const;

interface HistoryTimingLaneProps {
  /** 与活动轨同一个 viewModel：视口、日界、「现在」全部从这里取 */
  viewModel: HistoryTimelineViewModel;
  /** `focusApp` 高亮键（应用可执行名）；命中的段加环。为空 = 不高亮 */
  highlightSourceKey?: string | null;
}

function normalizeFocusKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export default function HistoryTimingLane({ viewModel, highlightSourceKey }: HistoryTimingLaneProps) {
  const locale = useLocale();
  const copy = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const segments = useTimingSegments({
    dayStartMs: viewModel.dayStartMs,
    dayEndMs: viewModel.dayEndMs,
    viewportStartMs: viewModel.viewportStartMs,
    viewportEndMs: viewModel.viewportEndMs,
    visibleEndMs: viewModel.visibleEndMs,
  });

  if (segments.length === 0) return null;

  const focusKey = normalizeFocusKey(highlightSourceKey);
  const formatBoundary = (timeMs: number) => (
    timeMs >= viewModel.dayEndMs ? "24:00" : formatTime(timeMs, locale)
  );

  return (
    <section
      className="history-timing-lane"
      aria-label={copy.title}
      data-history-timing-lane={copy.title}
      data-history-timing-lane-count={segments.length}
    >
      <div className="history-timing-lane-header">
        <h3 className="history-timing-lane-title">{copy.title}</h3>
        <span className="history-timing-lane-hint">{copy.hint}</span>
      </div>
      <QuietTimelineTrack
        axisTicks={viewModel.axisTicks}
        className="history-timing-lane-canvas"
        trackClassName="history-timing-lane-track"
        showAxis={false}
      >
        {segments.map((segment) => {
          /* 只为「一眼看出我点的那个应用」服务：事项名与应用名相同才点亮，
             不做模糊匹配（否则「Code」会把「VS Code」和「Code Review」一起点亮）。 */
          const focused = focusKey !== null && segment.label.trim().toLowerCase() === focusKey;
          const timeRange = `${formatBoundary(segment.startTime)} - ${formatBoundary(segment.endTime)}`;
          const runningLabel = segment.running ? ` ${copy.running}` : "";
          return (
            <Fragment key={segment.id}>
              <span
                className={focused
                  ? "history-timing-lane-segment history-timing-lane-segment--focus"
                  : "history-timing-lane-segment"}
                style={{
                  left: `${segment.startRatio * 100}%`,
                  width: `${Math.max(0, segment.widthRatio) * 100}%`,
                }}
                data-history-timing-segment={segment.itemId}
                data-running={segment.running ? "true" : undefined}
                data-focused={focused ? "true" : undefined}
                aria-label={`${segment.label} ${timeRange} ${formatDuration(segment.duration)}${runningLabel}`}
                title={`${segment.label} · ${timeRange} · ${formatDuration(segment.duration)}${runningLabel}`}
              />
              {/* PRD D1 明写「进行中的记录显示到「现在」**并标注「进行中」**」，
                  所以光有右端渐隐不够，必须有一处可读文案。位置钉在段右端（=「现在」那条竖线）；
                  右端已经贴到视口边缘时改挂到左侧，避免被轨道 `overflow: hidden` 裁掉。 */}
              {segment.running && (
                <span
                  className="history-timing-lane-running"
                  style={{
                    left: `${segment.endRatio * 100}%`,
                    /* translateY(-50%) 必须和 translateX 一起写：行内 `transform` 会整条覆盖
                       CSS 里的那一半，只写 translateX 会让标注掉到轨道下半截。 */
                    transform: segment.endRatio > 0.88
                      ? "translate(-100%, -50%)"
                      : "translate(6px, -50%)",
                  }}
                >
                  {copy.running}
                </span>
              )}
            </Fragment>
          );
        })}
      </QuietTimelineTrack>
    </section>
  );
}
