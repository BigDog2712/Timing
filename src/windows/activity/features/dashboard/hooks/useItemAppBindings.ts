import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClassificationAppCatalog } from "../../classification/hooks/useClassificationAppCatalog.ts";
import {
  listAppItemBindingOptions,
  resolveAppItemBindingExe,
  saveAppItemBinding,
} from "../services/appItemBinding.ts";
import {
  loadAppItemBindingUnions,
  mirrorItemBindingsOnce,
  type AppItemBindingUnion,
} from "../services/appItemBindingMirror.ts";

/**
 * 「这个事项绑了哪些应用」的读写状态（[0.13 fix]「编辑事项」弹层里的绑定应用一栏）。
 *
 * ## 为什么读的是配置表的**两份真源并集**，而不是宿主 `item_app`
 *
 * 分析窗没有宿主写命令、也没有 `list_item_apps` 的读权限（`permissions/activity-host-bridge.toml`
 * 只放行五条只读，且**不加写面**）。绑定在配置表里有**两份**：排行卡 / 本栏写的 1:1
 * `__app_item_binding::<exe>`，与应用设置弹窗写的 `__app_override::<exe>.itemBindings[]`。
 * 只读 1:1 的后果是用户报的第 6 条：在应用设置里绑了「燕云」，回到事项这边却显示
 * "还没有绑定应用"。所以这一栏读 `loadAppItemBindingUnions()`（1:1 ∪ override），
 * 判据是 `union.itemIds.includes(itemId)`；真正决定"会不会自动计时"的宿主 `item_app`
 * 仍由保存那一刻的镜像写拉平（`platform/runtime/itemAppBindingSync.ts`）。
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
  /** 已绑定到当前事项的应用（含只在应用设置里绑过的那些） */
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
  /** `统计应用 → 全集`（1:1 ∪ override，见文件头） */
  const [unions, setUnions] = useState<Record<string, AppItemBindingUnion>>({});
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
      loadAppItemBindingUnions().catch(() => null),
      /* 事项名只用于候选行上的「已绑在「X」」提示：读不到就退化成不提示，不降级整栏 */
      listAppItemBindingOptions().catch(() => null),
    ]);
    /* [0.13 fix] 存量绑定补一次镜像（宿主 `item_app` 在本轮之前根本没被写过）：
       先镜像再渲染，否则这一栏显示「已绑定」而药丸那边查不到 —— 与 bug 本身同一个症状。
       模块级只跑一次，不等它（它没有回执，等也等不出结果）。[第 6 条] 它自己读两份真源，
       与上面这次读**没有**依赖关系（上面失败也照补）。 */
    void mirrorItemBindingsOnce();
    if (!alive.current) return;
    setUnions(rows ?? {});
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
    return Object.entries(unions)
      /* 判据是**并集里有没有这个事项**，不是"1:1 是不是恰好它"：只在应用设置里
         绑过（override 型）的应用也必须有行，否则用户看到的还是"还没有绑定应用"。 */
      .filter(([, union]) => union.itemIds.includes(itemId))
      .map(([exeName]) => describe(exeName))
      .sort((left, right) => left.appName.localeCompare(right.appName));
  }, [unions, describe, itemId]);

  const candidates = useMemo(() => {
    if (itemId === null) return [];
    const rows: ItemAppBindingRow[] = [];
    for (const [exeName, appName] of catalogNames) {
      const boundItemIds = unions[exeName]?.itemIds ?? [];
      /* 已绑在本事项的从候选里摘掉（上面那一栏已经有了）；绑在别的事项的留着并给提示 */
      if (boundItemIds.includes(itemId)) continue;
      const otherItemId = boundItemIds[0];
      rows.push({
        exeName,
        appName,
        otherItemName: otherItemId === undefined ? null : (itemNames[otherItemId] ?? ""),
      });
    }
    return rows.sort((left, right) => left.appName.localeCompare(right.appName));
  }, [unions, catalogNames, itemId, itemNames]);

  const write = useCallback((exeName: string, nextItemId: number | null, removeItemId: number | null = null) => {
    const key = resolveAppItemBindingExe(exeName);
    if (!key) return;
    setSaveFailed(false);
    /* 第三个参数 = **这一次要摘掉的是哪一个事项**：本栏是事项视角，解绑的是当前事项，
       它未必是 1:1 指的那一条（应用同时绑了 3 与 9、用户在 9 上解绑）。
       `[第 6 条]` 不传的话 `saveAppItemBinding` 会按"应用视角主值"去摘 —— 摘错人。 */
    void saveAppItemBinding(key, nextItemId, removeItemId).then(
      () => {
        if (!alive.current) return;
        setUnions((current) => {
          const previous: AppItemBindingUnion = current[key] ?? {
            oneToOne: null,
            itemIds: [],
            trackOff: false,
          };
          const next = { ...current };
          if (nextItemId === null) {
            /* 从并集里摘掉**这一次解绑的那一条**（显式 id，缺省退回 1:1），
               其它事项原样留着 —— 本地更新不能跟着发"空并集"，那会让界面上另外几条也消失。 */
            const removedItemId = removeItemId ?? previous.oneToOne;
            const itemIds = removedItemId === null
              ? previous.itemIds
              : previous.itemIds.filter((entry) => entry !== removedItemId);
            const oneToOne = removedItemId !== null && previous.oneToOne === removedItemId
              ? null
              : previous.oneToOne;
            if (itemIds.length === 0) delete next[key];
            else next[key] = { ...previous, oneToOne, itemIds };
          } else {
            next[key] = {
              ...previous,
              oneToOne: nextItemId,
              itemIds: [...new Set([...previous.itemIds, nextItemId])].sort((left, right) => left - right),
            };
          }
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

  const unbind = useCallback(
    (exeName: string) => {
      if (itemId === null) return;
      write(exeName, null, itemId);
    },
    [itemId, write],
  );

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
