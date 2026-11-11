import { useRef, useState } from "react";
import type { UiText } from "../../../shared/i18n/index.ts";
import QuietSegmentedFilter, {
  type QuietSegmentedFilterOption,
} from "../../../shared/components/QuietSegmentedFilter.tsx";
import QuietDateRangePicker, {
  type QuietDateRangePickerSelection,
  type QuietResolvedDateRange,
} from "../../../shared/components/QuietDateRangePicker.tsx";
import { countInclusiveLocalDays, parseLocalDateKey } from "../../../shared/lib/localDate.ts";
import type {
  HistoryRangeCustomBounds,
  HistoryRangeMode,
} from "../services/historyRange.ts";
import type { HistoryRangeCopy } from "../rangeCopy.ts";

/**
 * 历史页档位条：单日 / 昨日 / 本周 / 近 7 天 / 近 30 天 / 自定义。
 *
 * 只做"选档"，不显示范围标签（标签在页头的日期位上，一处显示避免两处不同步）。
 *
 * 「自定义」的三段行为是刻意的：
 *   1. 从别的档**首次**点它 → 直接弹日期框选（还没有范围可恢复）；
 *   2. 已有上次框过的范围、但当前在别的档 → **直接切回去**，不打扰；
 *   3. 当前**就在**自定义档再点一次 → 弹框改日期。
 * 日期框选复用 `QuietDateRangePicker`（数据页同一个组件），所以"点两下选起止、
 * 反着选自动对调、未来日期禁用、取消/应用"这些行为与数据页逐字一致，不另造一套。
 */
interface Props {
  mode: HistoryRangeMode;
  customBounds: HistoryRangeCustomBounds | null;
  copy: HistoryRangeCopy;
  uiText: UiText;
  onModeChange: (mode: HistoryRangeMode) => void;
  onCustomBoundsChange: (bounds: HistoryRangeCustomBounds) => void;
}

function resolvePickerSelection(
  selection: QuietDateRangePickerSelection,
  copy: HistoryRangeCopy,
  nowMs: number,
): QuietResolvedDateRange {
  const todayKey = new Date(nowMs);
  todayKey.setHours(0, 0, 0, 0);
  const fallback = selection.kind === "custom" ? selection.startDateKey : selection.anchorDateKey;
  const left = selection.kind === "custom" ? selection.startDateKey : fallback;
  const right = selection.kind === "custom" ? selection.endDateKey : fallback;
  const leftDate = parseLocalDateKey(left);
  const rightDate = parseLocalDateKey(right);
  const start = leftDate && rightDate && leftDate <= rightDate ? left : right;
  const end = leftDate && rightDate && leftDate <= rightDate ? right : left;
  const dayCount = countInclusiveLocalDays(start, end);
  return {
    selection,
    startDateKey: start,
    endDateKey: end,
    dayCount,
    label: copy.customRange(start, end, dayCount),
  };
}

export default function HistoryRangeModeBar({
  mode,
  customBounds,
  copy,
  uiText,
  onModeChange,
  onCustomBoundsChange,
}: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState(copy.modeCustom);

  const options: QuietSegmentedFilterOption<HistoryRangeMode>[] = [
    { value: "day", label: copy.modeDay },
    { value: "yesterday", label: copy.modeYesterday },
    { value: "week", label: copy.modeWeek },
    { value: "last7", label: copy.modeLast7 },
    { value: "last30", label: copy.modeLast30 },
    { value: "custom", label: pickerOpen ? draftLabel : copy.modeCustom },
  ];

  return (
    <div ref={barRef} className="history-range-mode-bar">
      <QuietSegmentedFilter
        value={mode}
        options={options}
        ariaLabel={copy.rangeModeAria}
        onChange={(next) => {
          if (next !== "custom") {
            setPickerOpen(false);
            onModeChange(next);
            return;
          }
          if (mode === "custom") {
            setPickerOpen(true);
            return;
          }
          if (customBounds) {
            setPickerOpen(false);
            onModeChange("custom");
            return;
          }
          setPickerOpen(true);
        }}
      />
      {pickerOpen && barRef.current ? (
        <QuietDateRangePicker
          anchor={barRef.current}
          mode="custom"
          labels={{
            title: uiText.data.rangePickerTitle,
            modeLabels: {
              custom: uiText.data.pickerModes.custom,
              day: uiText.data.pickerModes.custom,
              week: uiText.data.pickerModes.week,
              month: uiText.data.pickerModes.month,
              year: uiText.data.pickerModes.year,
            },
            pickStartDate: uiText.data.pickStartDate,
            pickEndDate: uiText.data.pickEndDate,
            pickDate: uiText.data.pickDate,
            cancel: uiText.common.cancel,
            apply: uiText.data.applyRange,
            previousMonth: uiText.accessibility.date.previousMonth,
            nextMonth: uiText.accessibility.date.nextMonth,
            yearMonthLabel: uiText.date.yearMonthLabel,
            weekdaysShort: uiText.date.weekdaysShort,
          }}
          onDraftLabelChange={setDraftLabel}
          onClose={() => setPickerOpen(false)}
          resolveSelection={(selection, nowMs) => resolvePickerSelection(
            selection,
            copy,
            nowMs ?? Date.now(),
          )}
          onApply={(selection) => {
            const resolved = resolvePickerSelection(selection, copy, Date.now());
            onCustomBoundsChange({
              startDateKey: resolved.startDateKey,
              endDateKey: resolved.endDateKey,
            });
            onModeChange("custom");
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
