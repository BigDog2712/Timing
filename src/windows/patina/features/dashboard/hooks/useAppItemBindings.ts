import { useCallback, useEffect, useRef, useState } from "react";

import { AppClassification } from "../../../shared/classification/appClassification.ts";
import {
  listAppItemBindingOptions,
  loadAppItemBindings,
  saveAppItemBinding,
  type AppItemBindingOption,
} from "../services/appItemBinding.ts";

/**
 * 应用排行卡的「绑定事项」状态（0.12.1）。
 *
 * 三条纪律（与 `useTodayItems` 的降级口径一致，别改）：
 *   1. **挂载读一次 + 保存后局部更新**：读的是一次前缀扫描（`loadSettingRows`），
 *      不是逐行查；保存成功后只改那一个 key，不整表重读。
 *   2. **读失败降级为空对象 / 空清单**：主界面不许因为「绑定表读不到」变红
 *      —— 绑定是锦上添花，卡片的主体是排行本身。
 *   3. **`setBinding` 把错误抛回去**：写失败必须让弹层知道（它会走 `onError`），
 *      不能在 hook 里吞掉 —— 吞了用户会以为存上了。
 */
export interface AppItemBindingsState {
  /** `exeName → itemId`（全局，与卡片实例无关） */
  bindings: Record<string, number>;
  /** 候选事项；读失败时为空数组 + `itemsLoadFailed = true` */
  items: AppItemBindingOption[];
  itemsLoadFailed: boolean;
  setBinding: (exeName: string, itemId: number | null) => Promise<void>;
  reload: () => Promise<void>;
}

export function useAppItemBindings(): AppItemBindingsState {
  const [bindings, setBindings] = useState<Record<string, number>>({});
  const [items, setItems] = useState<AppItemBindingOption[]>([]);
  const [itemsLoadFailed, setItemsLoadFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const [nextBindings, nextItems] = await Promise.all([
      loadAppItemBindings().catch((error: unknown) => {
        console.warn("load app item bindings failed", error);
        return {} as Record<string, number>;
      }),
      listAppItemBindingOptions().then(
        (options) => ({ options, failed: false }),
        (error: unknown) => {
          console.warn("load app item binding options failed", error);
          return { options: [] as AppItemBindingOption[], failed: true };
        },
      ),
    ]);
    if (!mountedRef.current) return;
    setBindings(nextBindings);
    setItems(nextItems.options);
    setItemsLoadFailed(nextItems.failed);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setBinding = useCallback(async (exeName: string, itemId: number | null) => {
    await saveAppItemBinding(exeName, itemId);
    if (!mountedRef.current) return;
    /* 局部更新也落**归一后**的键：读侧（`parseAppItemBindingRows`）存的都是归一值，
       这里若按原始大小写写进 state，行标记要等到下次重读才看得到（与 S1 同一个坑）。 */
    const key = AppClassification.resolveStatisticalApp(exeName);
    if (!key) return;
    setBindings((current) => {
      const next = { ...current };
      if (itemId === null) delete next[key];
      else next[key] = itemId;
      return next;
    });
  }, []);

  return { bindings, items, itemsLoadFailed, setBinding, reload };
}
