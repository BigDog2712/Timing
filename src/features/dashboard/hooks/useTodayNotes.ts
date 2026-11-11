import { useCallback, useEffect, useMemo, useState } from "react";

import { listNoteSummaries } from "../../../platform/persistence/noteReadRepository.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";
import type { NoteSummary } from "../../../shared/types/notes.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/** 56px 通栏里排得下的张数（01 §4.3：head 88 + 3×note-card(≤280) + more 24） */
const VISIBLE_NOTES = 3;

export interface TodayNotesState {
  notes: NoteSummary[];
  /** 今日动过的总张数（> notes.length 时通栏末格显示 +N） */
  total: number;
  /** 三态互斥（不是 `loading: boolean`，理由见 `shared/types/loadStatus.ts`） */
  status: LoadStatus;
  /** 从错误态重试（E2 那块里的「重试」键） */
  retry: () => void;
}

/**
 * 今日便利贴：**按 `updatedAt` 落在今日本地日区间**筛选，降序，取前 3。
 *
 * 为什么不按 `createdAt`（01 §4.4.1 已裁定）：便利贴是**长期对象**，一张便签可以挂
 * 几个月。按创建日筛会让老用户这条**永远是空的** —— 一个只会随时间变空的入口，
 * 比没入口更糟。`updatedAt` = "今天动过的"，才是这条通栏的语义。
 *
 * `startOfLocalDay` 来自 `shared/lib/localDate.ts`（分析窗 shared，可直接引）；
 * 不用 `new Date().setHours(0,0,0,0)` 自己写，是因为那个文件已经处理了本地日/ISO key
 * 的一致性，重复实现只会在时区边界上分叉。
 *
 * 失败一律降级成空清单（`note_list` 的授权/命令缺失不该把主界面打红），只留一条 warn。
 */
export function useTodayNotes(refreshKey: number): TodayNotesState {
  const [rows, setRows] = useState<NoteSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    /* 已有数据时不退回 loading：刷新中把通栏换成骨架 = 每 30s 闪一次 */
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    void listNoteSummaries()
      .then((next) => {
        if (cancelled) return;
        setRows(next);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        /* 与 `useTodayTodos` 同一条纪律：**不许**把失败伪装成"今天没有便利贴"。
           保留已有行、只翻状态 —— 空态与错误态必须长得不一样。 */
        console.warn("Failed to load notes:", error);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [refreshKey, attempt]);

  const today = useMemo(() => {
    const from = startOfLocalDay(new Date()).getTime();
    return rows
      .filter((note) => note.updatedAt >= from)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [rows]);

  const retry = useCallback(() => { setAttempt((current) => current + 1); }, []);

  return { notes: today.slice(0, VISIBLE_NOTES), total: today.length, status, retry };
}
