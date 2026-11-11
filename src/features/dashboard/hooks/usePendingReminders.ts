/**
 * [提醒窗口卡 · 0.12.1] 待触发的提醒（事项 / 待办的到点提示）。
 *
 * 口径：`reminder_pending` 返回的是**还没触发完**的提醒，不是历史。
 * 卡片回答「今天还有什么在等着响」，所以按 `remindAt` 升序排、已经过点的排在最上面
 * （那些正是"该响了还没处理"的）。
 *
 * 为什么不做倒计时自刷新：倒计时是读屏噪音源（每秒变一次的数字），
 * 而且提醒真正到点时后端有自己的投递通道。这里跟着 `refreshKey`（切前台）重拉就够。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { listPendingReminders, type PendingReminder } from "../../../platform/persistence/reminderReadRepository.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

export interface PendingRemindersState {
  reminders: PendingReminder[];
  status: LoadStatus;
  retry: () => void;
}

export function usePendingReminders(refreshKey: number): PendingRemindersState {
  const [reminders, setReminders] = useState<PendingReminder[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const hasDataRef = useRef(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await listPendingReminders();
      if (!aliveRef.current) return;
      const sorted = [...list].sort((left, right) => left.remindAt - right.remindAt);
      hasDataRef.current = true;
      setReminders(sorted);
      setStatus("ready");
    } catch {
      if (!aliveRef.current) return;
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

  return { reminders, status, retry };
}
