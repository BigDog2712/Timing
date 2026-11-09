import { useEffect, useState } from "react";

import {
  loadTimingItemNames,
  loadTimingRecordSlices,
} from "../../../platform/runtime/timingOverlapGateway.ts";
import { buildTimingOverlap, type TimingOverlapSlice } from "../services/timingOverlap.ts";

/**
 * 当前这一天的「同期计时事项」。
 *
 * 三条口径：
 * 1. **失败即空**：命令被 ACL 拒、数据库打不开、宿主还没就绪 —— 一律退化成空数组，
 *    界面整块不渲染。这块是旁证，不该让历史页因为读不到它而报错。
 * 2. **区间变了才重查**：依赖只有 `fromMs`/`toMs`/`limit` 三个数，翻日期才触发；
 *    历史页每次渲染都换新对象也不会重查。
 * 3. **卸载即丢弃**：`cancelled` 标记挡住「已经翻到前一天、前一天的请求才回来」这种
 *    张冠李戴。
 */
export function useTimingOverlap(
  fromMs: number,
  toMs: number,
  limit = 5,
): TimingOverlapSlice[] {
  const [slices, setSlices] = useState<TimingOverlapSlice[]>([]);

  useEffect(() => {
    if (!(toMs > fromMs)) {
      setSlices([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [records, items] = await Promise.all([
          loadTimingRecordSlices(fromMs, toMs),
          loadTimingItemNames(),
        ]);
        if (!cancelled) {
          setSlices(buildTimingOverlap({ records, items }, limit));
        }
      } catch (error) {
        if (!cancelled) {
          setSlices([]);
          console.warn("Failed to load timing overlap", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromMs, toMs, limit]);

  return slices;
}
