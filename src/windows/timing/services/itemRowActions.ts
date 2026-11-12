/**
 * Timing — 事项窗的行级写操作（V0.4.2 从 `TodosPanel` 里搬出来）
 *
 * 拆出去的原因只有一条：面板加完「点行开始计时」之后越过 300 行纪律（AGENTS.md）。
 * 这里只放**改一条事项本身**的两个动作；待办与计时的动作各自有自己的 services。
 */
import { itemApi } from './api';
import { useItemStore } from '../stores/itemStore';

/** 改名（落库后重拉事项列表，今日记录行的显示名来自 `nameOf(itemId)`） */
export async function renameItem(itemId: number, name: string): Promise<void> {
  await itemApi.update({ id: itemId, patch: { name } });
  await useItemStore.getState().reload();
}

/** 删除事项（软删除，历史记录不受影响；删完要重拉今日记录） */
export async function deleteItem(itemId: number, reloadRecords: () => void): Promise<void> {
  await itemApi.remove({ id: itemId });
  await useItemStore.getState().reload();
  reloadRecords();
}
