/**
 * 「事项分类」的候选集合（[0.13] 主人反馈：新建事项 / 常用事项都要能设分类；[0.14] 接共享层）。
 *
 * ## 为什么不用分类页那份 `classificationStore`
 *
 * 那份 store 是**整页草稿**模型（bootstrap → 本地草稿 → 一次性提交），它服务的是
 * "分类页上的应用映射"。事项在**仪表盘卡**里改分类，是"改一条就落一条"的小动作，
 * 拿整页草稿会在两处之间制造一个从没被提交过的中间态。所以这里只读**定义**这一层。
 *
 * ## [0.14] 合并/排序/标签收敛到共享 `categoryCatalog.ts`
 *
 * 药丸窗（常用事项卡）要的是**同一份候选**——两窗各算各的，迟早漂移出
 * "应用能选到、事项选不到"。本钩子改为：读六组 KV 原始行（哑管道，同
 * `list_category_catalog` 的口径）→ 注入本窗标签回调（`getCategoryToken`，
 * 它同时覆盖内置名与自定义解码）→ 共享 builder 出候选。并集从"定义行"扩到
 * 应用侧四路（定义 ∪ app override 主分类 ∪ web override 主分类 ∪ 颜色覆盖键）。
 *
 * ## 顺序：内置 → 自定义（`other` 不在这里）
 *
 * 共享 builder 的唯一实现：内置按固定序在前，自定义按显示名 `zh-CN` 序在后。
 * **`other` 刻意不在返回值里**：它由 `ItemCategoryField` 作为哨兵项补在最前面
 * （出口翻 `null`），两边都补会出现两个「未分类」。
 *
 * ## `active` 为 false 时不请求
 *
 * 两个弹层（新建 / 事项管理）各调一次本 hook，但它们互斥打开；给 `active` 就能保证
 * 同一时刻只有一处真的去打 IPC。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCategoryToken, type AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import {
  loadSettingKeysByKeyPrefix,
  loadSettingRowsByKeyPrefix,
} from "../../../platform/persistence/classificationPersistence.ts";
import {
  buildCategoryCatalog,
  CATALOG_PREFIXES,
  type CategoryCatalogOption,
  type CategoryCatalogRows,
} from "../../../../shared/classification/categoryCatalog.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

export type ItemCategoryOption = CategoryCatalogOption;

export interface ItemCategoryOptionsState {
  options: ItemCategoryOption[];
  status: LoadStatus;
  /** 在分类管理里增删改之后调一次（候选必须跟着变，否则新分类选不到） */
  reload: () => void;
}

const EMPTY_CATALOG: CategoryCatalogRows = {
  definitions: [],
  deleted: [],
  labelOverrides: [],
  colorOverrides: [],
  appOverrides: [],
  webOverrides: [],
};

/** 六组前缀的读取方式：定义 / 删除只要键，其余四组要整行（key+value）。 */
function loadCatalog(active: boolean): Promise<CategoryCatalogRows> {
  if (!active) return Promise.resolve(EMPTY_CATALOG);
  return Promise.all([
    loadSettingKeysByKeyPrefix(CATALOG_PREFIXES.definitions),
    loadSettingKeysByKeyPrefix(CATALOG_PREFIXES.deleted),
    loadSettingRowsByKeyPrefix(CATALOG_PREFIXES.labelOverrides),
    loadSettingRowsByKeyPrefix(CATALOG_PREFIXES.colorOverrides),
    loadSettingRowsByKeyPrefix(CATALOG_PREFIXES.appOverrides),
    loadSettingRowsByKeyPrefix(CATALOG_PREFIXES.webOverrides),
  ]).then(([definitions, deleted, labelOverrides, colorOverrides, appOverrides, webOverrides]) => ({
    /* 定义 / 删除两组只读键（value 无用，补空串对齐共享层的行形状） */
    definitions: definitions.map((r) => ({ key: r.key, value: "" })),
    deleted: deleted.map((r) => ({ key: r.key, value: "" })),
    labelOverrides,
    colorOverrides,
    appOverrides,
    webOverrides,
  }));
}

export function useItemCategoryOptions(active: boolean): ItemCategoryOptionsState {
  const UI_TEXT = useLocaleText();
  const [catalog, setCatalog] = useState<CategoryCatalogRows>(EMPTY_CATALOG);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const loadedRef = useRef(false);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    if (!loadedRef.current) setStatus("loading");

    loadCatalog(active)
      .then((rows) => {
        if (cancelled) return;
        loadedRef.current = true;
        setCatalog(rows);
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

  /* 标签由本窗注入（内置 + 自定义解码都在 `getCategoryToken` 里），排序/合并全在共享层 ——
     本文件不再有自己的 sort 或 filter（那是第二个真源）。 */
  const options = useMemo<ItemCategoryOption[]>(
    () =>
      buildCategoryCatalog({
        catalog,
        builtinLabel: (key) => getCategoryToken(key as AppCategory, UI_TEXT).label,
        customLabel: () => null,
      }),
    [UI_TEXT, catalog],
  );

  return { options, status, reload };
}
