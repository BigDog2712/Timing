import type { TimingItemName, TimingRecordSpan } from "../../../platform/runtime/timingOverlapGateway.ts";

/**
 * 历史页「Timing 计时」泳道的段（P0-02）。
 *
 * 唯一坐标系 = `HistoryTimelineViewModel`（`src/shared/lib/activityTimelineCompiler.ts:105-118`）
 * 的 `viewportStartMs / viewportEndMs / visibleEndMs` + `dayStartMs / dayEndMs`。
 * 唯一比例公式 = 照抄同文件 `buildSegment`（`:437-482`）：
 *
 *   clippedStart = max(segStart, dayStartMs, viewportStartMs)
 *   clippedEnd   = min(segEnd,   dayEndMs, visibleEndMs, viewportEndMs)
 *   if (clippedEnd <= clippedStart) 丢弃该段
 *   startRatio   = (clippedStart - viewportStartMs) / viewportDurationMs
 *   widthRatio   = (clippedEnd - clippedStart)   / viewportDurationMs
 *
 * **不取整**（FUSION-ARCH-v1 §6.2）：任何 `Math.round` 到分钟都会引入 ≥30s 偏差，
 * 直接威胁「两泳道 ±1 分钟对齐」这条判据。所以这里只做比例，交给 CSS 百分比。
 */
export interface TimingLaneWindow {
  dayStartMs: number;
  dayEndMs: number;
  /** 当前视口（0–24h 或缩放后的窗口），与活动轨**同一个** */
  viewportStartMs: number;
  viewportEndMs: number;
  /** 「现在」的唯一来源：今日 = `min(dayEnd, now)`，历史日 = `dayEnd` */
  visibleEndMs: number;
}

export interface TimingLaneSegment {
  id: string;
  itemId: number;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  startRatio: number;
  endRatio: number;
  widthRatio: number;
  /** 真正在跑（`endedAt = null` 且 `runningSince != null`）；暂停中的不开这个角标 */
  running: boolean;
}

export interface TimingLaneSource {
  records: TimingRecordSpan[];
  items: TimingItemName[];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 记录 + 视口 → 与活动轨同坐标的段。
 *
 * 取舍：
 *  ① **名字查不到就丢掉这一段**（事项被硬删后无从归属）——与「同期计时」卡同一口径，
 *     宁可少一段，也不要出现 `#17` 这种没人能读懂的编号。
 *  ② **进行中画到 `visibleEndMs`**（§6.2：`endedAt === null` ⇒ 进行中），这样它的右端
 *     与活动轨的「现在」严格同一条竖线。
 *  ③ 按开始时间升序返回：渲染顺序稳定，重叠时后者压前者的层叠关系也稳定。
 */
export function buildTimingLaneSegments(
  source: TimingLaneSource,
  window: TimingLaneWindow,
): TimingLaneSegment[] {
  const names = new Map(source.items.map((item) => [item.id, item.name]));
  const viewportDurationMs = Math.max(1, window.viewportEndMs - window.viewportStartMs);
  const segments: TimingLaneSegment[] = [];

  for (const record of source.records) {
    const label = names.get(record.itemId);
    if (label === undefined) continue;
    if (!Number.isFinite(record.startedAt) || record.startedAt <= 0) continue;

    /* `endedAt === null` 表示这条记录还没结束（§6.2），墙钟右端取「现在」；
       是否**正在跑**另由 `runningSince` 判定（暂停中的记录也没有 endedAt）。 */
    const openEnded = record.endedAt === null;
    const rawEnd = record.endedAt ?? window.visibleEndMs;

    const clippedStart = Math.max(record.startedAt, window.dayStartMs, window.viewportStartMs);
    const clippedEnd = Math.min(rawEnd, window.dayEndMs, window.visibleEndMs, window.viewportEndMs);
    if (clippedEnd <= clippedStart) continue;

    const startRatio = clampRatio((clippedStart - window.viewportStartMs) / viewportDurationMs);
    const endRatio = clampRatio((clippedEnd - window.viewportStartMs) / viewportDurationMs);

    segments.push({
      id: `timing-${record.id}-${clippedStart}-${clippedEnd}`,
      itemId: record.itemId,
      label,
      startTime: clippedStart,
      endTime: clippedEnd,
      duration: clippedEnd - clippedStart,
      startRatio,
      endRatio,
      widthRatio: Math.max(0, endRatio - startRatio),
      running: openEnded && record.runningSince !== null,
    });
  }

  return segments.sort((a, b) => a.startTime - b.startTime || a.label.localeCompare(b.label));
}
