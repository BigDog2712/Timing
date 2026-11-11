import { useActivityDisplayColor } from "../hooks/useActivityDisplayColor.ts";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import QuietTooltip from "./QuietTooltip.tsx";
import { ANONYMOUS_ACTIVITY_BACKGROUND } from "../charts/AnonymousActivityPattern.tsx";
import type { TimelineAxisTick } from "../lib/timelineAxis.ts";

type TimelineTrackStyle = CSSProperties & Partial<Record<
  "--qp-timeline-segment-height",
  string
>>;

type TimelineSegmentStyle = CSSProperties & Record<
  | "--qp-timeline-segment-pattern"
  | "--qp-timeline-segment-left"
  | "--qp-timeline-segment-width"
  | "--qp-timeline-segment-color",
  string
>;

interface QuietTimelineTrackProps {
  children: ReactNode;
  axisTicks: readonly TimelineAxisTick[];
  className?: string;
  trackClassName?: string;
  axisClassName?: string;
  trackStyle?: TimelineTrackStyle;
  showAxis?: boolean;
}

interface QuietTimelineSegmentProps {
  anonymous?: boolean;
  ariaLabel: string;
  color: string;
  leftRatio: number;
  widthRatio: number;
  tooltip: ReactNode;
  className?: string;
  tooltipClassName?: string;
  disabled?: boolean;
  hideOnPointerDown?: boolean;
  /**
   * [P0-05] 传入即「这一段可点」。
   *
   * 默认 `undefined` —— 那样 `<span>` 仍是纯展示元素（没有 `role`、不可聚焦、无键盘处理），
   * 3 处既有用法（overview / expanded / lane）的 DOM 与 a11y 语义**一字不变**。
   * 只有真的传了这个回调，才升级成 `role="button"` + `tabIndex=0` + Enter/Space 触发，
   * 影响面因此是可枚举的：目前只有历史页 overview 轨的活动段传。
   */
  onActivate?: () => void;
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function QuietTimelineTrack({
  children,
  axisTicks,
  className,
  trackClassName,
  axisClassName,
  trackStyle,
  showAxis = true,
}: QuietTimelineTrackProps) {
  return (
    <div className={joinClasses("qp-timeline-canvas", className)}>
      <div
        className={joinClasses("qp-timeline-track", trackClassName)}
        style={trackStyle}
      >
        {children}
      </div>
      {showAxis && (
        <div
          className={joinClasses("qp-timeline-axis", axisClassName)}
          aria-hidden="true"
        >
          {axisTicks.map((tick) => (
            <span
              key={`${tick.label}:${tick.ratio}`}
              style={{ left: `${tick.ratio * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuietTimelineSegment({
  anonymous = false,
  ariaLabel,
  color,
  leftRatio,
  widthRatio,
  tooltip,
  className,
  tooltipClassName,
  disabled = false,
  hideOnPointerDown = true,
  onActivate,
}: QuietTimelineSegmentProps) {
  const displayColor = useActivityDisplayColor();
  const style: TimelineSegmentStyle = {
    "--qp-timeline-segment-pattern": anonymous ? ANONYMOUS_ACTIVITY_BACKGROUND : "none",
    "--qp-timeline-segment-left": `${leftRatio * 100}%`,
    "--qp-timeline-segment-width": `${Math.max(0, widthRatio) * 100}%`,
    "--qp-timeline-segment-color": displayColor(color, "timeline"),
  };
  /* 键盘可达：段是绝对定位的窄色块，鼠标点得中、Tab 也要能到。只在可点时挂。 */
  const handleKeyDown = onActivate === undefined
    ? undefined
    : (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    };

  return (
    <QuietTooltip
      label={tooltip}
      placement="top"
      disabled={disabled}
      hideOnPointerDown={hideOnPointerDown}
      className={joinClasses("qp-timeline-segment", className)}
      tooltipClassName={tooltipClassName}
      style={style}
    >
      <span
        aria-label={ariaLabel}
        role={onActivate === undefined ? undefined : "button"}
        tabIndex={onActivate === undefined ? undefined : 0}
        onClick={onActivate}
        onKeyDown={handleKeyDown}
        data-timeline-activatable={onActivate === undefined ? undefined : "true"}
      />
    </QuietTooltip>
  );
}

export type { TimelineTrackStyle as QuietTimelineTrackStyle };
