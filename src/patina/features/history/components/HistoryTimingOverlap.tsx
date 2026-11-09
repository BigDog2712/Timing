import { Clock } from "lucide-react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import type { TimingOverlapSlice } from "../services/timingOverlap.ts";

/**
 * 历史页左侧「同期计时」一行：这一天我在 Timing 里计了哪些事。
 *
 * 与宿主记录面板顶部那条「同时在用」（按应用聚合的电脑活动）互补：
 * 那边回答「我在用什么软件」，这边回答「我说在做什么事」，两边的区间是同一个。
 *
 * 空数组整块不渲染——没计过时不该出现一张空卡片。
 */
const COPY = {
  zh: { title: "同期计时", hint: "在 Timing 里计的事" },
  en: { title: "Timing entries", hint: "Tracked in Timing" },
} as const;

interface HistoryTimingOverlapProps {
  slices: TimingOverlapSlice[];
}

export default function HistoryTimingOverlap({ slices }: HistoryTimingOverlapProps) {
  const locale = useLocale();
  if (slices.length === 0) return null;
  const copy = locale.startsWith("zh") ? COPY.zh : COPY.en;

  return (
    <div className="qp-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="qp-weight-emphasis text-[var(--qp-text-primary)] qp-text-section-title">
          <Clock size={14} className="inline-block align-[-2px] mr-1.5" />
          {copy.title}
        </h3>
        <span className="qp-text-caption text-[var(--qp-text-tertiary)]">{copy.hint}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {slices.map((slice) => (
          <div key={slice.name} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[var(--qp-text-secondary)]">{slice.name}</span>
            <strong className="shrink-0 text-[var(--qp-text-primary)]">
              {formatDuration(slice.seconds * 1000)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
