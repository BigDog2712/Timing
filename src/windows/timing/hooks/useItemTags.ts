/**
 * Timing — 事项多标签的读取与保存（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 管理卡打开时读一次全量（`list_item_tags` 是「全部未删除事项」的哑清单），
 * 保存走覆盖写并同步内存，避免保存后重拉整份列表。
 */
import { useCallback, useEffect, useState } from 'react';

import { tagApi } from '../services/api';
import { IPC_EVENTS } from '../types/domain';
import { useTauriEvent } from './useTauriEvent';

export interface ItemTagsState {
  byItemId: Record<number, string[]>;
  save: (itemId: number, tags: string[]) => Promise<string[]>;
  reload: () => Promise<void>;
}

export function useItemTags(): ItemTagsState {
  const [byItemId, setByItemId] = useState<Record<number, string[]>>({});

  const reload = useCallback(async () => {
    const rows = await tagApi.list();
    setByItemId(Object.fromEntries(rows.map((row) => [row.itemId, row.tags])));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useTauriEvent<{ itemId: number }>(IPC_EVENTS.itemTagsChanged, () => {
    void reload();
  });

  const save = useCallback(async (itemId: number, tags: string[]) => {
    const stored = await tagApi.set(itemId, tags);
    setByItemId((current) => ({ ...current, [itemId]: stored }));
    return stored;
  }, []);

  return { byItemId, save, reload };
}