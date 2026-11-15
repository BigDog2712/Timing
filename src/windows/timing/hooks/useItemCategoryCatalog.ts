/**
 * Timing — 药丸窗分类候选 hook（[0.14] 两窗「事项分类选用」）。
 *
 * 调宿主命令 `list_category_catalog`（哑管道：六组 KV 原始行），合并 / 排序 /
 * 标签解析全在共享 `categoryCatalog.ts`（与分析窗同一份实现，谁都不许自带 sort）。
 * 标签注入 zh-only：内置键给 `BUILTIN_CATEGORY_LABELS_ZH`（parity 测试与分析窗
 * `uiText.categories` 十键逐字对齐），自定义键解码 + 兜底「自定义」。
 * `other` 不进候选（"未分类"哨兵由控件补，出口翻 `null`）。
 *
 * 生命周期：管理卡每次打开重新挂载， hook 跟着 mount 时取一次，不需要 reload。
 */
import { useEffect, useState } from 'react';

import { itemApi } from '../services/api';
import {
  BUILTIN_CATEGORY_LABELS_ZH,
  buildCategoryCatalog,
  type CategoryCatalogOption,
} from '../../shared/classification/categoryCatalog';

export type ItemCategoryOption = CategoryCatalogOption;

export interface ItemCategoryCatalogState {
  options: ItemCategoryOption[];
  /** true = 目录还在取（候选可以先空着，表单不让选） */
  loading: boolean;
}

/** 自定义键（`custom:<encoded>`）→ zh 显示名；现代 uuid 键给兜底「自定义」。 */
function decodeCustomLabel(key: string): string | null {
  const raw = key.slice('custom:'.length);
  if (!raw) return '自定义';
  if (/^category_[0-9a-z]+$/i.test(raw)) return '自定义';
  try {
    return decodeURIComponent(raw) || '自定义';
  } catch {
    return raw;
  }
}

export function useItemCategoryCatalog(): ItemCategoryCatalogState {
  const [options, setOptions] = useState<ItemCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void itemApi
      .categoryCatalog()
      .then((catalog) => {
        if (!alive) return;
        setOptions(
          buildCategoryCatalog({
            catalog,
            builtinLabel: (key) => BUILTIN_CATEGORY_LABELS_ZH[key] ?? null,
            customLabel: decodeCustomLabel,
          }),
        );
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        /* 目录读不到不挡表单：候选留空 + 当前值兜底（withCurrentValueOption 在控件侧补），失败打日志 */
        console.warn('load category catalog failed', error);
        setOptions([]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { options, loading };
}
