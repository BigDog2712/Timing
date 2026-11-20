/**
 * 活动热力图卡 · 按月：**一次**区间查询（一个月最多 31 天 × 6 个四小时桶 = 186 个边界）。
 *
 * 与 `useTrendDays` 的三条纪律一致（同一份数据源，只是窗口按月、桶按四小时）：
 *   · 一条 `cmd_get_activity_aggregate_range` 拿完，不按天/按时段拆成 N 次查询；
 *   · **同月刷新时已有数据不许退回 `loading`** —— 否则每次切前台整块闪一次骨架；
 *   · 读失败但有本月数据 → `ready`（E3：数字照旧，卡头挂小图标）。
 *
 * 换月是例外：那一页的数据还没读过，旧月份继续画着"已加载"就是假话 —— 先回 `loading`，
 * 失败则进 `error`（不是"上个月的数继续挂着"）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { addLocalMonths, startOfLocalMonth } from "../../../shared/lib/localDate.ts";
import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import {
  accumulateHeatmap,
  buildHeatmapPlan,
  emptyHeatmapModel,
  type HeatmapModel,
} from "../services/heatmapDays.ts";

export interface HeatmapState {
  model: HeatmapModel;
  status: LoadStatus;
  retry: () => void;
  /** 当前页的月份 0 点（月导航标签用；加载中也跟着目标月份走，不显示旧月份） */
  monthStartMs: number;
  /** 已经在当前月：下一页不再可点（不让人翻到未来） */
  canGoNext: boolean;
  goPrevious: () => void;
  goNext: () => void;
}

export function useHeatmapModel(refreshKey: number): HeatmapState {
  const [offset, setOffset] = useState(0);
  const [model, setModel] = useState<HeatmapModel>(emptyHeatmapModel);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const offsetRef = useRef(0);
  /** 成功读过的页码：`null` = 本月还没有数据 */
  const loadedOffsetRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (requested: number) => {
    try {
      /* `nowMs` 只取一次：跨过整点时重算一次是对的，每帧变则会每帧重查 */
      const plan = buildHeatmapPlan(Date.now(), requested);
      const result = await loadActivityAggregateRange(plan.startMs, plan.endMs, plan.boundaries);
      if (!aliveRef.current || offsetRef.current !== requested) return;
      loadedOffsetRef.current = requested;
      setModel(accumulateHeatmap(
        plan,
        result.records,
        /* 与 `useTrendDays` 同一条口径：格值来自后端的逐桶并集，不是把 records 加起来 */
        result.bucketUnionMs
          ? { boundaries: plan.boundaries, unionByBucket: result.bucketUnionMs }
          : undefined,
      ));
      setStatus("ready");
    } catch {
      if (!aliveRef.current || offsetRef.current !== requested) return;
      setStatus(loadedOffsetRef.current === requested ? "ready" : "error");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    offsetRef.current = offset;
    /* 换月先回 loading（同月刷新 / 重试成功前已读过的月份保持 ready 不闪） */
    setStatus(loadedOffsetRef.current === offset ? "ready" : "loading");
    void load(offset);
    return () => {
      aliveRef.current = false;
    };
  }, [load, offset, refreshKey]);

  const retry = useCallback(() => {
    setStatus(loadedOffsetRef.current === offset ? "ready" : "loading");
    void load(offset);
  }, [load, offset]);

  const goPrevious = useCallback(() => setOffset((current) => current + 1), []);
  const goNext = useCallback(() => setOffset((current) => Math.max(0, current - 1)), []);

  const monthStartMs = startOfLocalMonth(addLocalMonths(new Date(), -offset)).getTime();

  return {
    model,
    status,
    retry,
    monthStartMs,
    canGoNext: offset > 0,
    goPrevious,
    goNext,
  };
}