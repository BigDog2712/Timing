import { useCallback, useEffect, useMemo, useState } from "react";

import { listNoteSummaries } from "../../../platform/persistence/noteReadRepository.ts";
import type { NoteSummary } from "../../../shared/types/notes.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

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

  /* [P2 修正 · 0.12.1] 主人口径：「便利贴应显示所有便利贴」。
     原先按 `updatedAt` 落在今日筛，老用户会看到一条永远只剩今天几张的入口；
     现在全量返回、按最近改动降序，由卡片决定排几行（通栏可横向滚动）。 */
  const all = useMemo(
    () => rows.slice().sort((left, right) => right.updatedAt - left.updatedAt),
    [rows],
  );

  const retry = useCallback(() => { setAttempt((current) => current + 1); }, []);

  return { notes: all, total: all.length, status, retry };
}
