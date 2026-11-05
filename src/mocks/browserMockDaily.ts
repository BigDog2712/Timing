/**
 * Timing — 浏览器降级 Mock：日状态 / 丢弃计时 / 计时窗（3 条）
 * -----------------------------------------------------------------------------
 * 原文件为 `browserMockDiary.ts`（日记 / 日状态 / 丢弃计时 / 计时窗混装）。
 * [V0.3.4] 日记域整体下架（`diary_get_config|set_config|today|open_today` 四条命令删除），
 * 余下三条与日记无关，故拆出本文件并更名——**只删日记部分，其余保留**，
 * 否则 `check:contract` 的 mock 覆盖门禁会红（后端这三条命令仍在）。
 *
 * 语义对齐 `src-tauri/src/services/{daily_status,timer}.rs`，**不参与生产**。
 */
import { fail, type MockState } from './mockSeed';

/** 本地日期 YYYY-MM-DD（与 Rust 侧 `Local::now().date_naive()` 同口径） */
function todayText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createMockApiDaily(s: MockState): Record<string, (args?: any) => unknown> {
  return {
    /* ---- 日状态（勾选态）：按日期分组，仅存内存 ---- */
    daily_status_get: (a) => {
      const date = String(a?.date ?? todayText());
      return { ...(s.dailyStatus[date] ?? {}) };
    },
    daily_status_set: (a) => {
      const date = String(a?.date ?? todayText());
      const itemId = Number(a?.itemId);
      const status = a?.status === 'done' ? 'done' : 'pending';
      if (!Number.isFinite(itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      s.dailyStatus[date] = { ...(s.dailyStatus[date] ?? {}), [itemId]: status };
      return undefined;
    },

    /* ---- 丢弃当前会话：不产生记录，也不触发待办联动 ---- */
    discard_timer: () => {
      if (!s.active) fail('TIMER_NOT_RUNNING', '没有进行中的计时');
      s.active = null;
      return undefined;
    },

    /* ---- 只读计时窗：桌面端为独立窗口，浏览器 mock 下无窗口可开 ---- */
    open_timer_window: () => undefined,
  };
}
