import { useEffect, useMemo, useState } from "react";

import { subscribeHostTimerState } from "../../../platform/runtime/hostTimerGateway.ts";
import {
  loadTimingItemNames,
  loadTimingRecordSpans,
  type TimingItemName,
  type TimingRecordSpan,
} from "../../../platform/runtime/timingOverlapGateway.ts";
import {
  buildTimingLaneSegments,
  type TimingLaneSegment,
  type TimingLaneWindow,
} from "../services/timingLaneSegments.ts";

interface TimingLaneSourceState {
  records: TimingRecordSpan[];
  items: TimingItemName[];
}

const EMPTY_SOURCE: TimingLaneSourceState = { records: [], items: [] };

/**
 * 当前这一天「我在 Timing 里计了什么」的墙钟段（P0-02 泳道）。
 *
 * 三条口径（与 `useTimingOverlap` 同构）：
 * 1. **失败即空**：ACL 拒 / 库打不开 / 宿主没就绪 —— 一律退化成空数组，泳道整条不渲染。
 * 2. **取数与投影分开**：`list_records` 只依赖 `dayStartMs`/`dayEndMs`（翻日期才重查）；
 *    而「现在」`visibleEndMs` 每次刷新都会变，它只参与 `useMemo` 的比例计算。
 *    若把它并进取数依赖，进行中的段每跳一秒就要打一次 IPC —— 这是最容易写出来的
 *    「看着能用、跑一天打十万次查询」的坑。
 * 3. **卸载即丢弃**：`cancelled` 挡住「已经翻到前一天、前一天的请求才回来」。
 * 4. **记录变更靠门铃，不靠依赖**：取数只依赖日期区间，所以「记录变了」必须外部推一下。
 *    宿主写完记录会广播 `timer:state-changed`（`app.emit` = 全窗），载荷是状态快照——
 *    补记**不改状态**，那一帧「状态没变」是**预期**的，本 hook 只把它当「记录可能变了」的
 *    信号。这是本 hook **唯一**的刷新门铃，少了它用户点完补记界面什么都不变（像没生效）。
 *    将来若引入批量导入，需要统一的 `records-revision` 门铃，别把这里当 bug 删掉。
 */
export function useTimingSegments(window: TimingLaneWindow): TimingLaneSegment[] {
  const { dayStartMs, dayEndMs, viewportStartMs, viewportEndMs, visibleEndMs } = window;
  const [source, setSource] = useState<TimingLaneSourceState>(EMPTY_SOURCE);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    void subscribeHostTimerState(() => setRevision((n) => n + 1)).then((unlisten) => {
      if (active) stop = unlisten; else unlisten?.();
    });
    return () => { active = false; stop?.(); };
  }, []);

  useEffect(() => {
    if (!(dayEndMs > dayStartMs)) {
      setSource(EMPTY_SOURCE);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [records, items] = await Promise.all([
          loadTimingRecordSpans(dayStartMs, dayEndMs),
          loadTimingItemNames(),
        ]);
        if (!cancelled) setSource({ records, items });
      } catch (error) {
        if (!cancelled) {
          setSource(EMPTY_SOURCE);
          console.warn("Failed to load timing lane segments", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayStartMs, dayEndMs, revision]);

  return useMemo(
    () => buildTimingLaneSegments(source, {
      dayStartMs,
      dayEndMs,
      viewportStartMs,
      viewportEndMs,
      visibleEndMs,
    }),
    [source, dayStartMs, dayEndMs, viewportStartMs, viewportEndMs, visibleEndMs],
  );
}
