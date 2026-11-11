import { useId, useMemo, useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import AnonymousActivityPattern, { ANONYMOUS_ACTIVITY_STYLE } from "../../../shared/charts/AnonymousActivityPattern.tsx";
import { getCategoryToken } from "../../../shared/classification/categoryTokens.ts";
import { useActivityDisplayColor } from "../../../shared/hooks/useActivityDisplayColor.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration, type CategoryDistItem } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 模块 1 · 计时分布（01 §4.2：环复用旧 `DashboardFocusDonut` 的 SVG 数学，几何换档）
 *
 * 几何（01 §4.3，长档）：⌀144 / 描边 14 / 内径 116 → **viewBox 144，center 72，r 65**。
 * 旧常量是 viewBox 112 / center 56 / r 47 / stroke 16（47+8=55≈56），换算关系是
 * "center = r + stroke/2"，所以新值 65 + 7 = 72 仍然自洽。
 *
 * 短档（⌀120 / 12）**不换常量**：设计的两档环是同一张图按 120/144 缩放的，
 * 尺寸交给 CSS 的 `--qp-donut`，见 `tiers.css:78-82` 的推算与取舍。
 */

const DONUT_VIEWBOX = 144;
const DONUT_CENTER = 72;
const DONUT_RADIUS = 65;
const DONUT_STROKE_WIDTH = 14;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_GAP_DEGREES = 4;
/** 5 行读数 = 前 4 类 + 「其他」（几何表 readout 24 × 5 + gap 4 × 4 = 136 ≤ 环 144） */
const READOUT_LIMIT = 4;

interface Props {
  controls?: ReactNode;
  categoryDist: CategoryDistItem[];
  totalTrackedTime: number;
  dayDeltaTrackedTime: number;
  /** 快照源的同一个 `status`（E2/E3 都由它派生，不另算） */
  status: LoadStatus;
  /** 快照失败但仍有数据 = E3（卡头小图标） */
  refreshError: boolean;
  onRetry: () => void;
}

/** 前 4 类 + 其余合并成「其他」：环与读数行**同一份数组**，下标才能一一联动 */
function buildReadouts(
  categoryDist: CategoryDistItem[],
  otherLabel: string,
): CategoryDistItem[] {
  const visible = categoryDist.slice(0, READOUT_LIMIT);
  const restValue = categoryDist
    .slice(READOUT_LIMIT)
    .reduce((sum, item) => sum + Math.max(0, item.value), 0);

  if (restValue <= 0) return visible;

  return [...visible, {
    category: "other" as const,
    name: otherLabel,
    value: restValue,
    color: "var(--qp-text-tertiary)",
  }];
}

export default function TimerModule({
  controls,
  categoryDist,
  totalTrackedTime,
  dayDeltaTrackedTime,
  status,
  refreshError,
  onRetry,
}: Props) {
  const displayColor = useActivityDisplayColor();
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  const anonymousPatternId = useId();
  /** 环弧段 ↔ 读数行 双向联动（01 §4.2）；只存下标，不存对象 */
  const [hovered, setHovered] = useState<number | null>(null);

  const readouts = useMemo(() => {
    const localized = categoryDist.map((item) => ({
      ...item,
      name: item.name || getCategoryToken(item.category, UI_TEXT).label,
    }));
    return buildReadouts(localized, UI_TEXT.categories.other);
  }, [categoryDist, UI_TEXT]);

  const total = readouts.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const direction = dayDeltaTrackedTime > 0 ? "increase" : dayDeltaTrackedTime < 0 ? "decrease" : "same";
  const DeltaIcon = direction === "increase" ? TrendingUp : direction === "decrease" ? TrendingDown : Minus;
  const state = moduleState(status, refreshError, readouts.length === 0);

  let consumed = 0;

  return (
    <ModuleShell
      controls={controls}
      id="t-timer"
      title={copy.timerTitle}
      state={state}
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={onRetry}
      refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
      skeletonRows={5}
      emptyText={copy.timerEmpty}
      meta={(
        <>
          <DeltaIcon size={12} strokeWidth={2} aria-hidden="true" />
          {UI_TEXT.dashboard.comparedWithYesterday(
            formatDashboardDuration(Math.abs(dayDeltaTrackedTime)),
            direction,
          )}
        </>
      )}
    >
      <div className="qp-donut-body">
        {/* 环只是同一份数据的第二表达，读数行才是可读内容 → 环对读屏隐藏，
            否则同一组占比会被读两遍（01 §4.3 骨架里环无 role） */}
        <div className="qp-donut">
          <svg viewBox={`0 0 ${DONUT_VIEWBOX} ${DONUT_VIEWBOX}`} aria-hidden="true" focusable="false">
            <AnonymousActivityPattern id={anonymousPatternId} />
            <circle
              cx={DONUT_CENTER}
              cy={DONUT_CENTER}
              fill="none"
              r={DONUT_RADIUS}
              stroke="var(--qp-track-muted)"
              strokeWidth={DONUT_STROKE_WIDTH}
            />
            {total > 0 ? readouts.map((item, index) => {
              const segmentLength = (Math.max(0, item.value) / total) * DONUT_CIRCUMFERENCE;
              const gapLength = Math.min(segmentLength, DONUT_CIRCUMFERENCE * DONUT_GAP_DEGREES / 360);
              const dashLength = Math.max(0, segmentLength - gapLength);
              const dashOffset = -consumed;
              consumed += segmentLength;
              return (
                <circle
                  key={`${item.category}:${index}`}
                  cx={DONUT_CENTER}
                  cy={DONUT_CENTER}
                  fill="none"
                  r={DONUT_RADIUS}
                  stroke={item.category === "anonymous"
                    ? `url(#${anonymousPatternId})`
                    : displayColor(item.color) || "var(--qp-accent-default)"}
                  strokeDasharray={`${dashLength} ${DONUT_CIRCUMFERENCE - dashLength}`}
                  strokeDashoffset={dashOffset}
                  strokeOpacity={hovered === null || hovered === index ? 1 : 0.35}
                  strokeWidth={DONUT_STROKE_WIDTH}
                  transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
                />
              );
            }) : null}
          </svg>
          <div className="qp-donut-center">
            <span className="qp-donut-total">{formatDashboardDuration(totalTrackedTime)}</span>
            <span className="qp-donut-cap">{UI_TEXT.dashboard.total}</span>
          </div>
        </div>

        <ul className="qp-readouts">
          {readouts.map((item, index) => (
            <li
              key={`${item.category}:${index}`}
              className="qp-readout"
              data-hover={hovered === index || undefined}
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(null)}
            >
              <span
                className="qp-readout-dot"
                aria-hidden="true"
                style={{
                  backgroundColor: displayColor(item.color) || "var(--qp-accent-default)",
                  ...(item.category === "anonymous" ? ANONYMOUS_ACTIVITY_STYLE : {}),
                }}
              />
              <span className="qp-readout-name" title={item.name}>{item.name}</span>
              <span className="qp-readout-value">{formatDashboardDuration(item.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ModuleShell>
  );
}
