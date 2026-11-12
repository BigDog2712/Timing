/**
 * [应用趋势卡 · 今日分时] 今天每小时时长：**一次**区间查询 + 逐时桶边界。
 *
 * 为什么不是查 24 次单小时：主界面每次切前台都会刷新，24 条查询 × 每次切换 = 无谓的库压力；
 * 后端一条 `cmd_get_activity_aggregate_range` 带上桶边界就返回逐桶聚合，
 * 与历史页的区间视图走的是同一条路（口径因此天然一致）。
 *
 * 刷新纪律（与 `useTodayTodos` / `useTodayNotes` 同一条）：**已有数据时不许退回 `loading`**。
 * 退回的话 `ModuleShell.moduleState()` 会把卡片换成骨架 —— 每次切前台整块闪一次。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import { accumulateTrendDays, buildTodayHourPlan, type TrendDay } from "../services/trendDays.ts";

export interface TrendState {
  /** 今日逐时桶（按时间升序，最后一桶 = 当前这一小时） */
  days: TrendDay[];
  status: LoadStatus;
  retry: () => void;
}

export function useTrendDays(refreshKey: number): TrendState {
  const [days, setDays] = useState<TrendDay[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const hasDataRef = useRef(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      /* `nowMs` 在这里只取一次：跨过整点时重算一次是正常的，每帧变则会每帧重查 */
      const plan = buildTodayHourPlan(Date.now());
      const result = await loadActivityAggregateRange(plan.startMs, plan.endMs, plan.boundaries);
      if (!aliveRef.current) return;
      const next = accumulateTrendDays(plan.windows, result.records);
      hasDataRef.current = true;
      setDays(next);
      setStatus("ready");
    } catch {
      if (!aliveRef.current) return;
      /* 有旧数据 → 保持 ready（E3：数字照旧显示，不把卡片变成错误块） */
      setStatus(hasDataRef.current ? "ready" : "error");
    }
  }, []);

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

  return { days, status, retry };
}
