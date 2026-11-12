/**
 * 活动热力图卡 · 近 4 周：**一次**区间查询（672 个格子的桶边界）。
 *
 * 与 `useTrendDays` 的三条纪律完全一致（同一份数据源，只是桶更细、窗口更长）：
 *   · 一条 `cmd_get_activity_aggregate_range` 拿完，不按天/按小时拆成 N 次查询；
 *   · **已有数据时不许退回 `loading`** —— 否则每次切前台整块闪一次骨架；
 *   · 读失败但有旧数据 → `ready`（E3：数字照旧，卡头挂小图标）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import {
  accumulateHeatmap,
  buildHeatmapPlan,
  emptyHeatmapModel,
  HEATMAP_WEEKS,
  type HeatmapModel,
} from "../services/heatmapDays.ts";

export interface HeatmapState {
  model: HeatmapModel;
  status: LoadStatus;
  retry: () => void;
}

export function useHeatmapModel(refreshKey: number, weeks: number = HEATMAP_WEEKS): HeatmapState {
  const [model, setModel] = useState<HeatmapModel>(emptyHeatmapModel);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const hasDataRef = useRef(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      /* `nowMs` 只取一次：跨过整点时重算一次是对的，每帧变则会每帧重查 */
      const plan = buildHeatmapPlan(Date.now(), weeks);
      const result = await loadActivityAggregateRange(plan.startMs, plan.endMs, plan.boundaries);
      if (!aliveRef.current) return;
      hasDataRef.current = true;
      setModel(accumulateHeatmap(plan, result.records));
      setStatus("ready");
    } catch {
      if (!aliveRef.current) return;
      setStatus(hasDataRef.current ? "ready" : "error");
    }
  }, [weeks]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load, refreshKey]);

  const retry = useCallback(() => {
    setStatus(hasDataRef.current ? "ready" : "loading");
    void load();
  }, [load]);

  return { model, status, retry };
}
