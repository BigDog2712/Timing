import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /**
   * 删除**已经发出去**之后就地摘掉这一张（[本轮] 便利贴可删除）。
   *
   * 为什么不能只等下一次定时刷新：意图走的是事件桥，宿主落库有一小段延迟，
   * 刷新又是 30s 一次 —— 中间用户会看到「删了又蹦回来」，然后怀疑删除没生效。
   * 所以先本地摘掉，再把 id 记进"待消失"集合，后续每次刷新结果里继续过滤它；
   * 直到某一次结果里它**本来就不在了**，才把 id 从集合里摘掉（那时宿主的删除已经落库）。
   */
  removeLocal: (noteId: number) => void;
}

/**
 * 今日便利贴：全量返回、按最近改动降序（[P2 修正] 主人口径「便利贴应显示所有便利贴」）。
 *
 * 为什么历史上一度按 `updatedAt` 落在今日本地日区间筛（01 §4.4.1 已裁定过）：
 * 便利贴是**长期对象**，按创建日筛会让老用户这条**永远是空的** —— 一个只会随时间变空的
 * 入口，比没入口更糟。现在全量给，由卡片决定排几行（通栏可横向滚动）。
 *
 * 失败一律降级成空清单（`note_list` 的授权/命令缺失不该把主界面打红），只留一条 warn。
 */
export function useTodayNotes(refreshKey: number): TodayNotesState {
  const [rows, setRows] = useState<NoteSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  /* 已发出删除意图、但宿主还没落库的 id。ref 而不是 state：它只用于"过滤下一次结果"，
     由 `removeLocal` 顺带的那次 `setRows` 触发重渲染，不需要自己再排一次刷新。 */
  const pendingDeletedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    /* 已有数据时不退回 loading：刷新中把通栏换成骨架 = 每 30s 闪一次 */
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    void listNoteSummaries()
      .then((next) => {
        if (cancelled) return;
        /* 宿主已经真的删掉了：把 id 从"待消失"里摘掉，此后不再过滤它（它本来也不在） */
        const pending = pendingDeletedRef.current;
        if (pending.size > 0) {
          const returned = new Set(next.map((row) => row.id));
          for (const id of Array.from(pending)) {
            if (!returned.has(id)) pending.delete(id);
          }
        }
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
    () => rows
      .filter((row) => !pendingDeletedRef.current.has(row.id))
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [rows],
  );

  const retry = useCallback(() => { setAttempt((current) => current + 1); }, []);

  const removeLocal = useCallback((noteId: number) => {
    pendingDeletedRef.current.add(noteId);
    setRows((current) => current.filter((row) => row.id !== noteId));
  }, []);

  return { notes: all, total: all.length, status, retry, removeLocal };
}
