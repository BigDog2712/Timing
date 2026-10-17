/**
 * TickBar — 事项动作（批2 N-7；常用事项共用；唯一改事项口径）
 * -----------------------------------------------------------------------------
 * 注意 命令集约束（Spec §5 锁定）：仅用 `listItems` / `listRecords` / `updateItem({isPinned})`。
 *    common-items.md 提到的 `item_list_recent` / `item_pin` / `item_unpin` **不在锁定集内**，
 *    故「最近 5 条」由 `list_records` 最近记录**前端派生**，固定任务走 `updateItem({isPinned})`。
 */
import { ipc } from './ipc';
import { useItemStore } from '../stores/itemStore';

/** 「最近使用」派生上下文（CommonItems 用） */
export interface RecentContext {
  /** 按最近使用排序的事项 id（去重，保持首次出现顺序） */
  recentIds: number[];
  /** itemId -> 最近一次倒计时目标（秒）；仅含用过倒计时的事项 */
  countdownPresets: Record<number, number>;
}

export const itemsActions = {
  /** 固定 / 取消固定（固定任务置顶于常用之前） */
  async setPinned(id: number, isPinned: boolean): Promise<void> {
    await ipc.updateItem({ id, patch: { isPinned } });
    await useItemStore.getState().reload();
  },

  /**
   * 从最近记录派生「最近使用事项」与「上次倒计时预设」。
   * 取不到（无记录 / 请求失败）→ 返回空上下文，由调用方退化为 sortOrder 排序。
   */
  async loadRecentContext(scan = 60): Promise<RecentContext> {
    try {
      const page = await ipc.listRecords({ page: 1, limit: scan });
      const recentIds: number[] = [];
      const countdownPresets: Record<number, number> = {};
      for (const r of page.items) {
        if (!recentIds.includes(r.itemId)) recentIds.push(r.itemId);
        if (countdownPresets[r.itemId] == null && r.mode === 'countdown' && r.targetSec != null) {
          countdownPresets[r.itemId] = r.targetSec;
        }
      }
      return { recentIds, countdownPresets };
    } catch {
      return { recentIds: [], countdownPresets: {} };
    }
  },
};
