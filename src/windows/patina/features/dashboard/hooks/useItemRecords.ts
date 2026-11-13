/**
 * 某事项**当天的原始记录段**（0.13 · T03b）—— 只在「改起止」弹层打开时拉。
 *
 * ## 为什么不塞进 `useTodayItems` 的轮询
 *
 * `useTodayItems` 每 30 s 把多段记录聚成一行（`TodayItemRow`），拿不到"第几段"；
 * 若把原始段（`listTimingRecords` 上限 200 条）塞进它的每一次轮询，用户绝大多数
 * 时候不看这个弹层，等于每一趟多背 200 行。与 `useTodayNotes` 的"按需拉"同型。
 *
 * ## 拉取窗口
 *
 * 与 `useTodayItems` 同一个日区间（本地今天 `[0 点, 次日 0 点)`），`listTimingRecords`
 * 后按 `itemId` 过滤——命令本身支持 `itemId` 入参，但网关层的兼容读法两种返回形态
 * 都认，过滤在本地做更稳（不依赖旧宿主版本的行为差异）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { listTimingRecords } from "../../../platform/persistence/timingReadRepository.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/** 弹层里一行可编辑的记录段（字段与 `TimingRecord` 对齐，进行中 = `endedAt: null`） */
export interface ItemRecordSegment {
  id: number;
  startedAt: number;
  endedAt: number | null;
  /** 时长唯一来源（§3.8 B4：前端不许自己重算） */
  accumulatedSec: number;
  status: string;
}

export interface ItemRecordsState {
  segments: ItemRecordSegment[];
  status: LoadStatus;
  /** 保存后调用：重拉一次（意图没有回执，落库由宿主收敛；这里只刷新本地列表） */
  reload: () => void;
}

export function useItemRecords(
  itemId: number | null,
  dayStart: number,
  dayEnd: number,
): ItemRecordsState {
  const [segments, setSegments] = useState<ItemRecordSegment[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    /* `itemId === null` = 弹层没开：不拉、清列表（上次打开的残留段不该给下一次用） */
    if (itemId === null) {
      setSegments([]);
      setStatus("loading");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setStatus((current) => (current === "ready" ? current : "loading"));
      try {
        const records = await listTimingRecords(dayStart, dayEnd);
        if (cancelled || !aliveRef.current) return;
        setSegments(records
          .filter((record) => record.itemId === itemId)
          .map((record) => ({
            id: record.id,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            accumulatedSec: record.accumulatedSec,
            status: record.status,
          }))
          .sort((left, right) => left.startedAt - right.startedAt));
        setStatus("ready");
      } catch (error) {
        if (cancelled || !aliveRef.current) return;
        console.warn("load item records failed", error);
        setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
      aliveRef.current = false;
    };
  }, [itemId, dayStart, dayEnd, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { segments, status, reload };
}
