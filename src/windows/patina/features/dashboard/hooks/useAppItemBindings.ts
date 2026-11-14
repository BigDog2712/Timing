import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppClassification } from "../../../shared/classification/appClassification.ts";
import {
  listAppItemBindingOptions,
  saveAppItemBinding,
  type AppItemBindingOption,
} from "../services/appItemBinding.ts";
import {
  loadAppItemBindingUnions,
  mirrorItemBindingsOnce,
  type AppItemBindingUnion,
} from "../services/appItemBindingMirror.ts";

/**
 * 应用排行卡的「绑定事项」状态（0.12.1）。
 *
 * 三条纪律（与 `useTodayItems` 的降级口径一致，别改）：
 *   1. **挂载读一次 + 保存后局部更新**：读的是两次前缀扫描（`loadSettingRows`，1:1 与 override
 *      各一次、并行），不是逐行查；保存成功后只改那一个 key，不整表重读。
 *   2. **读失败降级为空对象 / 空清单**：主界面不许因为「绑定表读不到」变红
 *      —— 绑定是锦上添花，卡片的主体是排行本身。
 *   3. **`setBinding` 把错误抛回去**：写失败必须让弹层知道（它会走 `onError`），
 *      不能在 hook 里吞掉 —— 吞了用户会以为存上了。
 *
 * ## [第 6 条] 读的是**两份真源的并集**，不是 1:1 那一份
 *
 * 绑定有两条写入路径：本卡的行内快捷编辑（1:1 `__app_item_binding::<exe>`）与数据页的
 * 应用设置弹窗（多事项 `__app_override::<exe>.itemBindings[]`）。只读 1:1 时，**只在弹窗里
 * 绑过**的应用在这一卡上是"没有标记"的（用户报的「绑了却显示未绑定」，截图就是这一栏）。
 * 所以读 `loadAppItemBindingUnions()`，行标记 / 弹层初值都取并集的**主值**：
 * `oneToOne ?? itemIds[0]`（与 `planAppItemBindingWrite` 解绑时摘掉的那一个同一条规则）。
 *
 * 行标记仍然只画**一个**事项名（`qp-app-binding` 是一行 12px 的标记，不是清单）：多事项
 * 绑定在事项视角（`useItemAppBindings`）里才是完整清单。这里取主值就够了 —— 用户要的是
 * "这个应用是绑着事的"，不是"绑了几件"。
 *
 * ## [R6] 点「不绑定」之后行标记可能还在（显示下一件事项）—— 这是刻意的
 *
 * 本栏解绑的是**当前主值**（`oneToOne ?? itemIds[0]`），不是"把这个应用的所有绑定都清掉"：
 * 应用若还绑着别的事项，并集非空，行标记就会换成那一条继续显示。用户视角是"我解绑了，
 * 标记换了个名字"而不是"标记消失"，看着像没生效；但另一条路（解绑即清空全部）会**删掉
 * 用户在应用设置弹窗里配的其它事项**，是数据损失。取舍：只摘主值，行标记按并集重算。
 * 判据 `hook08`（解绑后 `bindings` 变成并集里剩下的那一条）。
 */
export interface AppItemBindingsState {
  /** `exeName → 主事项 id`（全局，与卡片实例无关；主值 = 1:1 优先，其次并集第一个） */
  bindings: Record<string, number>;
  /** 候选事项；读失败时为空数组 + `itemsLoadFailed = true` */
  items: AppItemBindingOption[];
  itemsLoadFailed: boolean;
  setBinding: (exeName: string, itemId: number | null) => Promise<void>;
  reload: () => Promise<void>;
}

export function useAppItemBindings(): AppItemBindingsState {
  const [unions, setUnions] = useState<Record<string, AppItemBindingUnion>>({});
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
    const [nextUnions, nextItems] = await Promise.all([
      loadAppItemBindingUnions().catch((error: unknown) => {
        console.warn("load app item bindings failed", error);
        return {} as Record<string, AppItemBindingUnion>;
      }),
      listAppItemBindingOptions().then(
        (options) => ({ options, failed: false }),
        (error: unknown) => {
          console.warn("load app item binding options failed", error);
          return { options: [] as AppItemBindingOption[], failed: true };
        },
      ),
    ]);
    /* [0.13 fix] 存量绑定补一次镜像（宿主 `item_app` 在本轮之前根本没被写过）。
       应用卡是最常被打开的那一扇门，放这里是为了让老用户不必先去别处"重新绑一遍"。
       [第 6 条] 它**自己**读两份真源（1:1 ∪ override）再逐应用发并集 —— 不收调用方
       手里的视图：`nextUnions` 是归并后的并集，但补镜像**不**吃它（它要读库，不能吃
       一次可能已经降级成 `{}` 的界面状态）。 */
    void mirrorItemBindingsOnce();
    if (!mountedRef.current) return;
    setUnions(nextUnions);
    setItems(nextItems.options);
    setItemsLoadFailed(nextItems.failed);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 并集 → 行标记要的那一个 id。`oneToOne` 与 `itemIds[0]` 同属一条并集，所以这里
     不会出现"标记指向一个并集里没有的事项"（union 构造时 1:1 就已并进 `itemIds`）。 */
  const bindings = useMemo(() => {
    const primary: Record<string, number> = {};
    for (const [exeName, union] of Object.entries(unions)) {
      const main = union.oneToOne ?? union.itemIds[0];
      if (main !== undefined) primary[exeName] = main;
    }
    return primary;
  }, [unions]);

  const setBinding = useCallback(async (exeName: string, itemId: number | null) => {
    await saveAppItemBinding(exeName, itemId);
    if (!mountedRef.current) return;
    /* 局部更新也落**归一后**的键：读侧（`parseAppItemBindingRows`）存的都是归一值，
       这里若按原始大小写写进 state，行标记要等到下次重读才看得到（与 S1 同一个坑）。 */
    const key = AppClassification.resolveStatisticalApp(exeName);
    if (!key) return;
    setUnions((current) => {
      const previous: AppItemBindingUnion = current[key] ?? { oneToOne: null, itemIds: [], trackOff: false };
      const next = { ...current };
      if (itemId === null) {
        /* 摘的是**这次会真的被摘掉的那一个**（`oneToOne ?? itemIds[0]`，与
           `planAppItemBindingWrite` 同一条规则）。并集里其它事项原样留着 ——
           本地更新不能跟着发"空并集"，那会让行标记连同别的事项一起消失。 */
        const removed = previous.oneToOne ?? previous.itemIds[0];
        const itemIds = removed === undefined
          ? previous.itemIds
          : previous.itemIds.filter((entry) => entry !== removed);
        if (itemIds.length === 0) delete next[key];
        else next[key] = { ...previous, oneToOne: null, itemIds };
      } else {
        next[key] = {
          ...previous,
          oneToOne: itemId,
          itemIds: [...new Set([...previous.itemIds, itemId])].sort((left, right) => left - right),
        };
      }
      return next;
    });
  }, []);

  return { bindings, items, itemsLoadFailed, setBinding, reload };
}
