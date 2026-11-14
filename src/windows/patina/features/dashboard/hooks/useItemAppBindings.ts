import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClassificationAppCatalog } from "../../classification/hooks/useClassificationAppCatalog.ts";
import {
  listAppItemBindingOptions,
  loadAppItemBindings,
  mirrorItemBindingsOnce,
  resolveAppItemBindingExe,
  saveAppItemBinding,
} from "../services/appItemBinding.ts";

/**
 * 「这个事项绑了哪些应用」的读写状态（[0.13 fix]「编辑事项」弹层里的绑定应用一栏）。
 *
 * ## 为什么读的是配置表的**反查**，而不是宿主 `item_app`
 *
 * 分析窗没有宿主写命令、也没有 `list_item_apps` 的读权限（`permissions/patina-host-bridge.toml`
 * 只放行五条只读，且**不加写面**）。这一栏与「应用排行卡 → 绑定事项」用的是**同一个
 * 1:1 键空间**（`__app_item_binding::<exe>` → `{itemId}`），所以两边看到的是同一份事实；
 * 真正决定"会不会自动计时"的宿主 `item_app` 由保存那一刻的镜像写拉平
 * （`platform/runtime/itemAppBindingSync.ts`）。
 *
 * ## 三条纪律（与 `useAppItemBindings` 同一条降级口径）
 *
 *   1. **挂载读一次 + 保存后局部更新**：写成功后只改那一个键，不整表重读（省一次前缀扫描，
 *      也避免"重读还没回来又把刚选的应用刷没"的闪烁）。
 *   2. **读失败降级为空**：这一栏是给绑定用的，读不到时不要连累名称/时长的编辑。
 *   3. **写失败置 `saveFailed`**：让人看得见 —— 静默失败会退化成"我以为绑上了"，
 *      正是本次 bug 的形态。
 *
 * ## 键一律过 `resolveAppItemBindingExe`
 *
 * 应用目录侧给的是「规范 exe」，配置表侧给的是「统计应用」（多走一层应用关联
 * `__app_link::`）。两边不归一就会出现"明明是同一个 Chrome，已绑定清单里一条、
 * 候选里又一条"。归一只在这一个函数里做（写侧 `buildAppItemBindingKey` 内部也是它）。
 */
export interface ItemAppBindingRow {
  /** 归一后的应用键（`__app_item_binding::` 的后半段，也用作 `key`） */
  exeName: string;
  /** 展示名（应用目录给的，读不到时回落 exeName） */
  appName: string;
  /** 该应用当前绑在**别的事项**上；`null` = 未绑定 */
  otherItemName: string | null;
}

export interface ItemAppBindingsState {
  /** 已绑定到当前事项的应用 */
  bound: ItemAppBindingRow[];
  /** 可以绑的应用（含「已绑在别的事项」的那些：1:1 键空间，选它等于挪过来） */
  candidates: ItemAppBindingRow[];
  loading: boolean;
  /** 配置表读失败（清单降级为空，不阻塞其它编辑） */
  loadFailed: boolean;
  /** 应用目录读失败 / 还没读到 */
  appsFailed: boolean;
  /** 上一次写失败 */
  saveFailed: boolean;
  bind: (exeName: string) => void;
  unbind: (exeName: string) => void;
}

export function useItemAppBindings(
  itemId: number | null,
  enabled: boolean,
): ItemAppBindingsState {
  const catalog = useClassificationAppCatalog({ enabled });
  const [bindings, setBindings] = useState<Record<string, number>>({});
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const [rows, items] = await Promise.all([
      loadAppItemBindings().catch(() => null),
      /* 事项名只用于候选行上的「已绑在「X」」提示：读不到就退化成不提示，不降级整栏 */
      listAppItemBindingOptions().catch(() => null),
    ]);
    /* [0.13 fix] 存量绑定补一次镜像（宿主 `item_app` 在本轮之前根本没被写过）：
       先镜像再渲染，否则这一栏显示「已绑定」而药丸那边查不到 —— 与 bug 本身同一个症状。
       模块级只跑一次，不等它（它没有回执，等也等不出结果）。 */
    if (rows) void mirrorItemBindingsOnce(rows);
    if (!alive.current) return;
    setBindings(rows ?? {});
    setLoadFailed(rows === null);
    setItemNames(Object.fromEntries((items ?? []).map((entry) => [entry.id, entry.name] as const)));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled || itemId === null) return;
    void reload();
  }, [enabled, itemId, reload]);

  /** 应用目录：归一后去重（同一统计应用可能有多条规范 exe），名字优先用目录给的 */
  const catalogNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const candidate of catalog.candidates) {
      const key = resolveAppItemBindingExe(candidate.exeName);
      if (!key || names.has(key)) continue;
      const appName = candidate.appName.trim() || candidate.exeName.trim();
      names.set(key, appName || key);
    }
    return names;
  }, [catalog.candidates]);

  const describe = useCallback(
    (exeName: string): ItemAppBindingRow => ({
      exeName,
      appName: catalogNames.get(exeName) ?? exeName,
      otherItemName: null,
    }),
    [catalogNames],
  );

  const bound = useMemo(() => {
    if (itemId === null) return [];
    return Object.entries(bindings)
      .filter(([, boundItemId]) => boundItemId === itemId)
      .map(([exeName]) => describe(exeName))
      .sort((left, right) => left.appName.localeCompare(right.appName));
  }, [bindings, describe, itemId]);

  const candidates = useMemo(() => {
    if (itemId === null) return [];
    const rows: ItemAppBindingRow[] = [];
    for (const [exeName, appName] of catalogNames) {
      const boundItemId = bindings[exeName];
      /* 已绑在本事项的从候选里摘掉（上面那一栏已经有了）；绑在别的事项的留着并给提示 */
      if (boundItemId === itemId) continue;
      rows.push({
        exeName,
        appName,
        otherItemName: boundItemId === undefined ? null : (itemNames[boundItemId] ?? ""),
      });
    }
    return rows.sort((left, right) => left.appName.localeCompare(right.appName));
  }, [bindings, catalogNames, itemId, itemNames]);

  const write = useCallback((exeName: string, nextItemId: number | null) => {
    const key = resolveAppItemBindingExe(exeName);
    if (!key) return;
    setSaveFailed(false);
    void saveAppItemBinding(key, nextItemId).then(
      () => {
        if (!alive.current) return;
        setBindings((current) => {
          const next = { ...current };
          if (nextItemId === null) delete next[key];
          else next[key] = nextItemId;
          return next;
        });
      },
      () => {
        if (alive.current) setSaveFailed(true);
      },
    );
  }, []);

  const bind = useCallback(
    (exeName: string) => {
      if (itemId === null) return;
      write(exeName, itemId);
    },
    [itemId, write],
  );

  const unbind = useCallback((exeName: string) => write(exeName, null), [write]);

  return {
    bound,
    candidates,
    loading,
    loadFailed,
    appsFailed: catalog.error,
    saveFailed,
    bind,
    unbind,
  };
}
