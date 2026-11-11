import { Expand, Minus, Plus, Tags, ZoomIn } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction";

/**
 * 历史页时间轴的三个图标动作 + 「最短活动时长」步进器。
 *
 * 抽出来的理由只有一条：`History.tsx` 冻结在 **1147 行**（size-allowlist 棘轮，只许减），
 * 要给区间视图腾地方就必须先把这些"只依赖 props、不碰页内状态"的片段搬出去。
 * 搬的时候 className 一个字都没改（`history-horizontal-timeline-action` 等），
 * 所以 `history.css` / `timeline-lane.css` 里的选择器不受影响。
 */
export interface HistoryTimelineActionLabels {
  modeTitle: string;
  modeAriaLabel: string;
  zoomTitle: string;
  openTitle: string;
}

interface ActionButtonsProps {
  labels: HistoryTimelineActionLabels;
  /** 三个按钮的类名后缀分别由调用点决定（概览轨 / 缩放弹窗各一套），保持既有 class 不变 */
  modeClassName?: string;
  zoomClassName?: string;
  openClassName?: string;
  onToggleMode: () => void;
  onOpenZoom: () => void;
  onOpenTimeline: () => void;
}

export function HistoryTimelineModeButton({
  labels,
  className = "",
  onToggle,
}: {
  labels: HistoryTimelineActionLabels;
  className?: string;
  onToggle: () => void;
}) {
  return (
    <QuietIconAction
      icon={<Tags size={15} />}
      title={labels.modeTitle}
      ariaLabel={labels.modeAriaLabel}
      className={`history-timeline-mode-toggle history-horizontal-timeline-action ${className}`.trim()}
      showTooltip={false}
      onClick={onToggle}
    />
  );
}

export function HistoryTimelineActionButtons({
  labels,
  modeClassName = "",
  zoomClassName = "",
  openClassName = "",
  onToggleMode,
  onOpenZoom,
  onOpenTimeline,
}: ActionButtonsProps) {
  return (
    <>
      <HistoryTimelineModeButton labels={labels} className={modeClassName} onToggle={onToggleMode} />
      <QuietIconAction
        icon={<ZoomIn size={14} />}
        title={labels.zoomTitle}
        ariaLabel={labels.zoomTitle}
        className={`history-horizontal-timeline-action history-timeline-zoom-open ${zoomClassName}`.trim()}
        onClick={onOpenZoom}
      />
      <QuietIconAction
        icon={<Expand size={15} />}
        title={labels.openTitle}
        ariaLabel={labels.openTitle}
        className={`history-horizontal-timeline-action history-timeline-open ${openClassName}`.trim()}
        onClick={onOpenTimeline}
      />
    </>
  );
}

interface MinDurationControlProps {
  minutes: number;
  canDecrease: boolean;
  canIncrease: boolean;
  valueLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
  className?: string;
  onChange: (minutes: number) => void;
}

export function HistoryMinDurationControl({
  minutes,
  canDecrease,
  canIncrease,
  valueLabel,
  decreaseLabel,
  increaseLabel,
  className = "",
  onChange,
}: MinDurationControlProps) {
  return (
    <div className={`flex max-w-[124px] items-center justify-end gap-1.5 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => onChange(minutes - 1)}
        disabled={!canDecrease}
        aria-label={decreaseLabel}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Minus size={11} />
      </button>
      <span className="min-w-[62px] text-center qp-text-caption qp-weight-medium tabular-nums text-[var(--qp-text-secondary)]">
        {valueLabel}
      </span>
      <button
        type="button"
        onClick={() => onChange(minutes + 1)}
        disabled={!canIncrease}
        aria-label={increaseLabel}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={11} />
      </button>
    </div>
  );
}
