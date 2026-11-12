import { useId, useMemo, useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import AnonymousActivityPattern, { ANONYMOUS_ACTIVITY_STYLE } from "../../../shared/charts/AnonymousActivityPattern.tsx";
import { getCategoryToken } from "../../../shared/classification/categoryTokens.ts";
import { useActivityDisplayColor } from "../../../shared/hooks/useActivityDisplayColor.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration, type CategoryDistItem } from "../services/dashboardFormatting.ts";
import { FOCUS_DIMENSIONS, type FocusDimension } from "../services/focusDimension.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 模块 1 · 计时分布（**几何逐值照抄 `widgets/focus.rs`**）
 *
 * Rust 的环不是固定 ⌀132：`d = min(内容高, 0.46×内容宽)` 再 clamp 到 86–158，
 * 描边 `0.135d`（不小于 9），片间缝隙按弧长 1.6px 折算角度。这里保留一套 viewBox
 * （d = 144），把**比例**写死，实际直径交给 CSS 的 `--qp-donut-fit`：
 *   · 描边 19.44 / 144 = 0.135   → 与 Rust 同粗
 *   · 中径 62.28 = 72 − 19.44/2  → 内外缘比例与 Rust 一致
 *   · 缝隙 1.47° ≈ 1.6px 弧长（r=62.28）
 *
 * 环心读数与 Rust 一样是**一整串同号字**（`19.5` 粗 + `今日合计` 10）：
 * 原来把 `h` / `m` 降成 0.62em，放大到 158 的环里会多出一处"层级"，
 * 而 Rust 那张卡上没有这一层。
 */

const DONUT_VIEWBOX = 144;
const DONUT_CENTER = 72;
const DONUT_RADIUS = 62.28;
const DONUT_STROKE_WIDTH = 19.44;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_GAP_DEGREES = 1.47;
/** 5 行图例 = 前 4 类 + 「其他」（Rust 前 5 名单独成条，第 6 名起并入「其他」） */
const READOUT_LIMIT = 4;

interface Props {
  controls?: ReactNode;
  categoryDist: CategoryDistItem[];
  /** [P2] 当前维度：分类 / 应用 / 窗口标题（数据由 `buildFocusDistribution` 给好）。 */
  dimension: FocusDimension;
  onDimensionChange: (dimension: FocusDimension) => void;
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
  dimension,
  onDimensionChange,
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
      /* 卡头读数就是 exe 的 `meta(Timer)`：「今日 14m」（`widgets/mod.rs:141`）。
         昨日对比不在卡头 —— 它在维度那一行的右端（见下）。 */
      meta={copy.timerToday(formatDashboardDuration(totalTrackedTime))}
    >
      {/* [P2] 三个维度：同一份总量换分组，不是三份数据。切维度只换这一个 state
          （v3 起提到 `Dashboard` 视图层，板上多个计时卡共用一个口径），
          环与读数行仍是同一份数组（段数 = 行数这条不变）。 */}
      <div className="qp-focus-bar">
        <div className="qp-focus-dims" role="tablist" aria-label={copy.focusDimensionLabel}>
          {FOCUS_DIMENSIONS.map((dim) => (
            <button
              key={dim}
              type="button"
              role="tab"
              aria-selected={dim === dimension}
              className="qp-focus-dim"
              data-active={dim === dimension || undefined}
              onClick={() => onDimensionChange(dim)}
            >
              {copy.focusDimensions[dim]}
            </button>
          ))}
        </div>
        {/* 较昨日读数与维度共用一行（`focus.rs:54-69`：读数右对齐在 `tabs` 那条 24 高的
            横带里，10.5px）。放进卡头会把这一行挤成两行，卡头高度是几何表锁死的。 */}
        <span className="qp-focus-delta" data-dir={direction}>
          <DeltaIcon size={11} strokeWidth={2} aria-hidden="true" />
          {UI_TEXT.dashboard.comparedWithYesterday(
            formatDashboardDuration(Math.abs(dayDeltaTrackedTime)),
            direction,
          )}
        </span>
      </div>
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
            <span className="qp-donut-cap">{copy.timerDonutCap}</span>
          </div>
        </div>

        <ul className="qp-readouts">
          {readouts.map((item, index) => {
            /* Rust 的图例每行两段：名称（12）与「百分比 · 时长」（10）。百分比在这层算，
             * 用**同一份** readouts 的总量 —— 环、名称、占比三者永远自洽。 */
            const percent = total > 0 ? Math.round((Math.max(0, item.value) / total) * 100) : 0;
            return (
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
                <span className="qp-readout-sub">
                  {`${percent}%  ·  ${formatDashboardDuration(item.value)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </ModuleShell>
  );
}
