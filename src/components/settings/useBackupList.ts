/**
 * Timing — 设置 · 数据管理 · 备份列表的**单一数据源**（V0.11.16，PRD R11 / 设计 §3.1）
 * -----------------------------------------------------------------------------
 * 为什么需要它：块⑤改成默认折叠之后，折叠标题下要显示**当条记录**，而列表数据在
 * `MdSyncBackupCard` 的子树里。最省事的写法是「卡片再拉一次 `md_backup_list`」——
 * 于是打开设置页会发两条一模一样的命令，而且两次结果可能不同（一件写成两件事）。
 *
 * 所以列表在这里拉**一次**，`MdSyncTab` 把同一个 `list` 交给 ⑤ 的 `summary` 槽与
 * `MdSyncBackupCard`：那一行与展开后的第一条**必然同源同值**（PRD F2）。
 *
 * 手机端（`IS_MOBILE`）**早退不调 IPC**：`md_backup_list` 在手机端会返回
 * `MD_SYNC_CONFIG_INVALID`，拉一次就是设置页一片红字（块⑤在手机端整块不渲染）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdBackupApi } from '../../services/api';
import type { MdBackupItem } from '../../types/domain';

export interface MdBackupList {
  items: MdBackupItem[];
  loading: boolean;
  error: string | null;
  /** 重新拉一遍（刷新按钮、恢复之后各调一次） */
  refresh(): Promise<void>;
  /** `items` 里 `atMs` 最大的那条；空列表 → `null` */
  latest: MdBackupItem | null;
}

export function useBackupList(): MdBackupList {
  const [items, setItems] = useState<MdBackupItem[]>([]);
  /* 手机端没有「正在读取」这一帧：它压根不会去读 */
  const [loading, setLoading] = useState(!IS_MOBILE);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (IS_MOBILE) return;
    setLoading(true);
    try {
      setItems(await mdBackupApi.list());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* 「最新一条」= 全局 `atMs` 最大者（后端已按组内倒序，这里再取一次全局） */
  const latest = useMemo(() => {
    let best: MdBackupItem | null = null;
    for (const item of items) {
      if (best === null || item.atMs > best.atMs) best = item;
    }
    return best;
  }, [items]);

  return { items, loading, error, refresh, latest };
}
