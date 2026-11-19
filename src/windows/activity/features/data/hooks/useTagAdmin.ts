import { useCallback, useEffect, useMemo, useState } from "react";

import { listTimingItemTags } from "../../../platform/persistence/timingReadRepository.ts";
import {
  createTagDefinition,
  deleteTagPath,
  listTagDefinitions,
  renameTagPath,
} from "../../../platform/persistence/tagAdminGateway.ts";
import { buildTagTree, collectTagPaths, type TagNode } from "../../../../shared/tags/tagTree.ts";

/**
 * 数据页「标签管理」的状态：定义行 + 走量（有多少条事项在用）。
 *
 * 两路数据源刻意分开：
 *   · 定义行（`list_tag_catalog`）—— 没有事项引用的空标签靠它存在；
 *   · 引用（`list_item_tags`）—— 走量、树的枝叶。
 * 合成后的节点集合 = 两者之并，所以「新建一个还没用的标签」也能立刻出现在树里。
 *
 * 改名 / 删除是后端一个事务做完的（含子树），这里只负责在返回后把两路重读一遍：
 * 自己在前端推算「哪些路径被改了」迟早漏掉一条（跨事项 + 定义行两份数据）。
 */
export interface TagAdminState {
  tree: TagNode[];
  paths: string[];
  /** 路径 → 直接引用条数 */
  counts: Record<string, number>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (path: string) => Promise<string[]>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

export function useTagAdmin(): TagAdminState {
  const [definitions, setDefinitions] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, assignments] = await Promise.all([listTagDefinitions(), listTimingItemTags()]);
      const next: Record<string, number> = {};
      for (const row of assignments) {
        for (const tag of row.tags) next[tag] = (next[tag] ?? 0) + 1;
      }
      setDefinitions(catalog);
      setCounts(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标签读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(() => {
    const entries = new Map<string, { path: string; count: number }>();
    for (const path of definitions) entries.set(path, { path, count: counts[path] ?? 0 });
    for (const [path, count] of Object.entries(counts)) entries.set(path, { path, count });
    return buildTagTree([...entries.values()]);
  }, [definitions, counts]);

  const paths = useMemo(() => collectTagPaths(tree), [tree]);

  const create = useCallback(
    async (path: string) => {
      const next = await createTagDefinition(path);
      setDefinitions(next);
      return next;
    },
    [],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      await renameTagPath(from, to);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (path: string) => {
      await deleteTagPath(path);
      await load();
    },
    [load],
  );

  return { tree, paths, counts, loading, error, reload: load, create, rename, remove };
}
