/**
 * 「应用 → 分类」候选集的取数与写入。
 *
 * ## 为什么每次写完整组，而不是只写变化的那一条
 *
 * 上移/下移会重排整组的 `priority`：只写「被移动的那条」会与下一条撞号
 * （两条同 priority 时规则 2 退化成按 key 字典序 —— 用户点了上移，界面跳了，
 * 下次读出来又跳回去）。这里先本地重排、再把 priority 真的变了的逐条 upsert。
 *
 * ## 为什么允许写一个「还不存在的分类」
 *
 * `category_key` 是自由字符串（用户写的「摸鱼」就是它本身）。Rust 侧
 * `app_category_service` 明确不校验分类是否已定义 —— 键可能来自另一台机器的导入数据。
 * 界面同样不拦：先让用户把绑定配好，之后建同名分类就自动生效。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listAppCategories,
  removeAppCategory,
  setAppCategory,
  type AppCategoryRow,
} from "../../../platform/persistence/attributionGateway.ts";
import { appendCategory, groupByApp, moveCategory, sortCategories } from "../services/appCategoryOrder.ts";

export interface UseAppCategoriesResult {
  /** `appKey → 有序分类`（组内已按 priority + 字典序排好，与后端规则一致） */
  groups: ReadonlyMap<string, AppCategoryRow[]>;
  loading: boolean;
  error: string | null;
  /** 正在写的应用（按钮据此禁用，避免同一行连点造成两组重排交错） */
  savingAppKey: string | null;
  refresh: () => Promise<void>;
  move: (appKey: string, categoryKey: string, direction: "up" | "down") => Promise<void>;
  add: (appKey: string, categoryKey: string) => Promise<void>;
  remove: (appKey: string, categoryKey: string) => Promise<void>;
}

export function useAppCategories(): UseAppCategoriesResult {
  const [rows, setRows] = useState<AppCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAppKey, setSavingAppKey] = useState<string | null>(null);
  /* 卸载后不再 setState：这个面板会在设置页里被反复挂载，写到已卸载的组件上
     在 React 18 里不再报警告，表现为「切换页签后偶尔卡一下」。 */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const loaded = await listAppCategories();
      if (!alive.current) return;
      setRows(loaded);
      setError(null);
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 写一组「重排后的结果」：只 upsert priority 真的变了的，然后以库为准重载。 */
  const commitGroup = useCallback(
    async (appKey: string, ordered: readonly AppCategoryRow[]) => {
      setSavingAppKey(appKey);
      const before = new Map(rows.filter((row) => row.appKey === appKey).map((row) => [row.categoryKey, row.priority]));
      try {
        for (const row of ordered) {
          if (before.get(row.categoryKey) === row.priority) continue;
          await setAppCategory(row.appKey, row.categoryKey, row.priority);
        }
        await refresh();
      } catch (cause) {
        /* 写失败时不保留本地乐观结果：重排只写了一半时，界面上的顺序与库里的顺序
           不一致，而「首位」是会被切片当真的。宁可回到库里的旧顺序。 */
        if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
        await refresh();
      } finally {
        if (alive.current) setSavingAppKey(null);
      }
    },
    [refresh, rows],
  );

  const move = useCallback(
    async (appKey: string, categoryKey: string, direction: "up" | "down") => {
      const group = sortCategories(rows.filter((row) => row.appKey === appKey));
      await commitGroup(appKey, moveCategory(group, categoryKey, direction));
    },
    [commitGroup, rows],
  );

  const add = useCallback(
    async (appKey: string, categoryKey: string) => {
      const key = appKey.trim();
      const category = categoryKey.trim();
      if (!key || !category) return;
      const group = sortCategories(rows.filter((row) => row.appKey === key));
      if (group.some((row) => row.categoryKey === category)) return;
      await commitGroup(key, appendCategory(group, key, category));
    },
    [commitGroup, rows],
  );

  const remove = useCallback(
    async (appKey: string, categoryKey: string) => {
      setSavingAppKey(appKey);
      try {
        await removeAppCategory(appKey, categoryKey);
        await refresh();
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive.current) setSavingAppKey(null);
      }
    },
    [refresh],
  );

  const groups = useMemo(() => groupByApp(rows), [rows]);

  return { groups, loading, error, savingAppKey, refresh, move, add, remove };
}
