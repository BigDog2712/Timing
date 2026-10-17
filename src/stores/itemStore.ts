/**
 * TickBar — 事项 store
 * -----------------------------------------------------------------------------
 * 数据来源：list_items（排序 sort_order ASC, name ASC；系统事项「未归类」恒在）。
 */
import { create } from 'zustand';
import { ipc } from '../services/ipc';
import type { Item } from '../types/domain';

interface ItemStore {
  items: Item[];
  loaded: boolean;
  setItems: (items: Item[]) => void;
  reload: () => Promise<Item[]>;
}

export const useItemStore = create<ItemStore>((set) => ({
  items: [],
  loaded: false,
  setItems: (items) => set({ items, loaded: true }),
  reload: async () => {
    const items = await ipc.listItems({ includeArchived: false });
    set({ items, loaded: true });
    return items;
  },
}));

/** 依 id 取事项（含当前列表）；未找到返回 undefined */
export function findItem(items: Item[], id: number | null | undefined): Item | undefined {
  if (id == null) return undefined;
  return items.find((i) => i.id === id);
}

/** 依 id 取事项名（找不到时回退「未归类」文案） */
export function itemName(items: Item[], id: number | null | undefined): string {
  return findItem(items, id)?.name ?? '未归类';
}
