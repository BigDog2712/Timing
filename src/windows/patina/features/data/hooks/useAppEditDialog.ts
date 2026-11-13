import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { AppCategory, UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import { ProcessMapper, type AppOverride } from "../../../shared/classification/processMapper.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import {
  ClassificationService,
  type ClassificationBootstrapData,
} from "../../classification/services/classificationService.ts";
import {
  buildQuickClassificationCategoryOptions,
  resolveQuickClassificationOverride,
  saveQuickClassificationOverride,
} from "../../classification/services/quickClassification.ts";
import { createQuickAppClassificationTarget } from "../../classification/types.ts";
import { listAppItemBindingOptions } from "../../dashboard/services/appItemBinding.ts";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import {
  assignDraftItemCategory,
  buildDraftAppOverride,
  collectCategoryUsage,
  createAppEditDraft,
  isDraftDirty,
  promoteDraftCategory,
  toggleDraftCategory,
  toggleDraftItem,
  type AppEditDraft,
} from "../services/appEditDraft.ts";
import {
  useAppEditCategoryAdmin,
  type AppEditCategoryOption,
} from "./useAppEditCategoryAdmin.ts";

export type { AppEditCategoryOption };

/**
 * 「应用设置」弹窗的**读取 + 保存 + 草稿**编排（分类定义的增删改在
 * `useAppEditCategoryAdmin`，组件只画）。
 *
 * ## 关闭即丢弃，不弹"未保存"确认
 *
 * 主理人给的二选一取了后者（更简单）：弹窗一关就 `unmount`，草稿随组件状态一起消失，
 * 所以**不存在"下次打开带着上次残留"**——比在关闭回调里逐个 `setState(null)` 更彻底
 * （后者漏一个字段就会带上残留）。代价是未保存的改动会静默丢失，因此"保存"键必须
 * 在真的有改动时始终可点（`canSave`）。
 *
 * ## 读失败时必须禁保存
 *
 * bootstrap 挂了就等于 `currentOverride = null` + 空草稿；此时允许保存会把用户已有的
 * 分类 / 别名 / 事项绑定**整段抹平**。所以 `canSave` 里带着 `!loadFailed`。
 *
 * ## 一次读、一次写
 *
 * 读 = `ClassificationService.loadClassificationBootstrap()`（分类候选 / 用量 / 已删清单
 * 全在这份数据里，不额外查库）+ `listAppItemBindingOptions()`（事项清单，失败只降级那一栏）。
 * 写 = `saveQuickClassificationOverride()` —— 与快捷分类菜单同一条老路，**不新增 IPC 命令**
 * （insight 命令数被 contract 门禁钉着）。
 */
export interface AppEditDialogTarget {
  exeName: string;
  displayName: string;
  /** 打开时的分类（只用于构造 target 的展示字段，真正的分类来自 override） */
  category: AppCategory;
}

export interface AppEditDialogState {
  loading: boolean;
  loadFailed: boolean;
  saving: boolean;
  managing: boolean;
  error: string | null;
  draft: AppEditDraft;
  dirty: boolean;
  canSave: boolean;
  categoryOptions: AppEditCategoryOption[];
  categoryUsage: Record<string, number>;
  items: readonly { id: number; name: string; color?: string }[];
  itemsLoadFailed: boolean;
  toggleCategory: (category: UserAssignableAppCategory) => void;
  promoteCategory: (category: UserAssignableAppCategory) => void;
  toggleItem: (itemId: number) => void;
  assignItemCategory: (itemId: number, category: UserAssignableAppCategory | undefined) => void;
  save: () => void;
  createCategory: () => Promise<void>;
  renameCategory: (category: AppCategory, label: string) => Promise<void>;
  /** `null` = 恢复默认色（写 `value: null`），不是"什么都不做" */
  recolorCategory: (category: AppCategory, color: string | null) => Promise<void>;
  deleteCategory: (category: AppCategory) => Promise<void>;
  /** `useQuietDialogs` 的提示框 / 确认框节点（新建分类、删除确认） */
  dialogsElement: ReactNode;
}

export function useAppEditDialog({
  target: targetInput,
  onClose,
  onSaved,
}: {
  target: AppEditDialogTarget;
  onClose: () => void;
  onSaved?: () => void;
}): AppEditDialogState {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = APP_EDIT_COPY[locale];
  const target = useMemo(() => createQuickAppClassificationTarget({
    exeName: targetInput.exeName,
    displayName: targetInput.displayName,
    category: targetInput.category,
  }), [targetInput.category, targetInput.displayName, targetInput.exeName]);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AppOverride | null>(null);
  const [draft, setDraft] = useState<AppEditDraft>({ categories: [], itemBindings: [] });
  const [categoryOptions, setCategoryOptions] = useState<AppEditCategoryOption[]>([]);
  const [categoryUsage, setCategoryUsage] = useState<Record<string, number>>({});
  const [deletedCategories, setDeletedCategories] = useState<AppCategory[]>([]);
  const [items, setItems] = useState<readonly { id: number; name: string; color?: string }[]>([]);
  const [itemsLoadFailed, setItemsLoadFailed] = useState(false);
  const busyRef = useRef(false);
  const loadedRef = useRef(false);

  /** 分类候选 + 用量 + 已删清单（分类增删改之后重算，但**不许**动草稿） */
  const applyBootstrap = useCallback((bootstrap: ClassificationBootstrapData) => {
    setCategoryOptions(buildQuickClassificationCategoryOptions(bootstrap, UI_TEXT, locale).map((option) => ({
      ...option,
      /* 色块要画**生效**颜色：自定义色优先，没有就用该分类的默认色（不能留空串 ——
         `QuietColorField` 会把空串当颜色去解析） */
      color: bootstrap.loadedCategoryColorOverrides[option.value]
        ?? ProcessMapper.getDefaultCategoryColor(option.value),
    })));
    setCategoryUsage(collectCategoryUsage(bootstrap.loadedOverrides, bootstrap.loadedWebDomainOverrides));
    setDeletedCategories(bootstrap.loadedDeletedCategories);
  }, [UI_TEXT, locale]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let active = true;
    void (async () => {
      try {
        const [bootstrap, itemOptions] = await Promise.all([
          ClassificationService.loadClassificationBootstrap(),
          /* 事项清单失败只降级这一栏（照 `QuickClassificationItemBindingMenu` 的口径） */
          listAppItemBindingOptions().catch(() => null),
        ]);
        if (!active) return;
        const override = resolveQuickClassificationOverride(bootstrap, target) as AppOverride | null;
        setCurrent(override);
        setDraft(createAppEditDraft(override, bootstrap.loadedDeletedCategories));
        applyBootstrap(bootstrap);
        setItems(itemOptions ?? []);
        setItemsLoadFailed(itemOptions === null);
      } catch {
        if (!active) return;
        setLoadFailed(true);
        setError(copy.loadFailed);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyBootstrap, copy.loadFailed, target]);

  const refreshBootstrap = useCallback(async () => {
    /* 必须作废缓存：`classificationBootstrapCache` 会把"没有新分类"的那一份还回来 */
    ClassificationService.invalidateBootstrapCache();
    applyBootstrap(await ClassificationService.loadClassificationBootstrap());
  }, [applyBootstrap]);

  const admin = useAppEditCategoryAdmin({
    categoryOptions,
    categoryUsage,
    refreshBootstrap,
    onCreated: (category) => {
      /* 新建完直接勾上：用户点"新建分类"的意图就是"把这件事归到一个新分类" */
      setDraft((prev) => toggleDraftCategory(prev, category));
    },
    onDeleted: (category) => setDraft((prev) => (
      prev.categories.includes(category as UserAssignableAppCategory)
        ? toggleDraftCategory(prev, category as UserAssignableAppCategory)
        : prev
    )),
    onError: setError,
    onManagingChange: setManaging,
  });

  const save = useCallback(() => {
    if (busyRef.current || saving || loadFailed) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        await saveQuickClassificationOverride(target, buildDraftAppOverride(current, draft));
        /* 作废分类 bootstrap：下一个读这一行的视图（趋势列表 / 分类聚合）必须看到新配置 */
        ClassificationService.invalidateBootstrapCache();
        onSaved?.();
        onClose();
      } catch {
        setError(copy.saveFailed);
      } finally {
        busyRef.current = false;
        setSaving(false);
      }
    })();
  }, [copy.saveFailed, current, draft, loadFailed, onClose, onSaved, saving, target]);

  const dirty = !loading && isDraftDirty(draft, current, deletedCategories);

  return {
    loading,
    loadFailed,
    saving,
    managing,
    error,
    draft,
    dirty,
    /* 没改动 / 还在读 / 读失败都不给存：拿空草稿盖回去等于清库 */
    canSave: !loading && !loadFailed && !saving && dirty,
    categoryOptions,
    categoryUsage,
    items,
    itemsLoadFailed,
    toggleCategory: (category) => setDraft((prev) => toggleDraftCategory(prev, category)),
    promoteCategory: (category) => setDraft((prev) => promoteDraftCategory(prev, category)),
    toggleItem: (itemId) => setDraft((prev) => toggleDraftItem(prev, itemId)),
    assignItemCategory: (itemId, category) => setDraft((prev) => assignDraftItemCategory(prev, itemId, category)),
    save,
    createCategory: admin.createCategory,
    renameCategory: admin.renameCategory,
    recolorCategory: admin.recolorCategory,
    deleteCategory: admin.deleteCategory,
    dialogsElement: admin.dialogsElement,
  };
}
