/**
 * 「事项分类」的候选集合（[0.13] 主人反馈：新建事项 / 常用事项都要能设分类）。
 *
 * ## 为什么不用分类页那份 `classificationStore`
 *
 * 那份 store 是**整页草稿**模型（bootstrap → 本地草稿 → 一次性提交），它服务的是
 * "分类页上的应用映射"。事项在**仪表盘卡**里改分类，是"改一条就落一条"的小动作，
 * 拿整页草稿会在两处之间制造一个从没被提交过的中间态。所以这里只读**定义**这一层：
 * `loadActivityReminderCategoryCatalog()`（`__custom_category::` + 已删除过滤 +
 * label/color 覆盖），与提醒卡用的是同一个读取器 —— 分类候选只有一处口径。
 *
 * ## 顺序：内置 → 自定义（`other` 不在这里）
 *
 * 内置在前（按 `USER_ASSIGNABLE_CATEGORIES` 的既有顺序），自定义在后并按显示名排
 * （用户新建的那条不会因为 id 是 uuid 而随机插在中间）。
 * **`other` 刻意不在返回值里**：它是"未分类"这一项的落库值（`null`），由
 * `ItemCategoryField` 作为哨兵项补在最前面 —— 候选集合与"清空"是两件事，混在一起会出现
 * 两个「未分类」。
 *
 * ## `active` 为 false 时不请求
 *
 * 两个弹层（新建 / 事项管理）各调一次本 hook，但它们互斥打开；给 `active` 就能保证
 * 同一时刻只有一处真的去打 IPC。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getCategoryToken,
  isExtendedCategory,
  type AppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { loadActivityReminderCategoryCatalog } from "../../../platform/persistence/activityReminderCatalogGateway.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

export interface ItemCategoryOption {
  value: string;
  label: string;
}

interface LoadedCategory {
  id: AppCategory;
  labelOverride: string | null;
}

export interface ItemCategoryOptionsState {
  options: ItemCategoryOption[];
  status: LoadStatus;
  /** 在分类管理里增删改之后调一次（候选必须跟着变，否则新分类选不到） */
  reload: () => void;
}

export function useItemCategoryOptions(active: boolean): ItemCategoryOptionsState {
  const UI_TEXT = useLocaleText();
  const [rows, setRows] = useState<LoadedCategory[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const loadedRef = useRef(false);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    if (!loadedRef.current) setStatus("loading");

    void loadActivityReminderCategoryCatalog()
      .then((catalog) => {
        if (cancelled) return;
        loadedRef.current = true;
        setRows(catalog.map((row) => ({ id: row.categoryId, labelOverride: row.labelOverride })));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn("load item category options failed", error);
        setStatus((current) => (current === "ready" ? current : "error"));
      });

    return () => {
      cancelled = true;
    };
  }, [active, attempt]);

  const options = useMemo<ItemCategoryOption[]>(() => {
    const label = (row: LoadedCategory): string => (
      row.labelOverride?.trim() || getCategoryToken(row.id, UI_TEXT).label || row.id
    );
    const seeded = rows.filter((row) => !isExtendedCategory(row.id) && row.id !== "other");
    const extended = rows
      .filter((row) => isExtendedCategory(row.id))
      .sort((left, right) => label(left).localeCompare(label(right), "zh-CN"));
    /* **不列 `other`**：它由 `ItemCategoryField` 自己作为"空串 ∥ 未分类"的那一项补在最前面。
       两边都补一次会得到两个「未分类」（一个 value=""、一个 value="other"）——
       用户看到的是同一句话出现两遍，选哪个还决定了落库写的是 `null` 还是 `"other"`。 */
    return [...seeded, ...extended].map((row) => ({ value: row.id, label: label(row) }));
  }, [UI_TEXT, rows]);

  return { options, status, reload };
}
