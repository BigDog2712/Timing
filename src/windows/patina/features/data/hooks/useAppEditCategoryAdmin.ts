import { useCallback, useRef } from "react";

import {
  createCategoryId,
  normalizeCategoryLabelInput,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs.tsx";
import { commitClassificationSettingMutations } from "../../../platform/persistence/classificationSettingsGateway.ts";
import { CATEGORY_ADMIN_COPY } from "../../classification/categoryAdminCopy.ts";
import {
  buildCreateCategoryDefinitionMutations,
  buildDeleteCategoryBatchMutations,
} from "../../classification/services/categoryDefinitionMutations.ts";
import {
  buildSaveCategoryColorOverrideMutations,
  buildSaveCategoryLabelOverrideMutations,
  loadAppOverrides,
  loadWebDomainOverrides,
} from "../../classification/services/classificationStore.ts";
import type { QuickClassificationCategoryOption } from "../../classification/services/quickClassification.ts";
import { APP_EDIT_COPY } from "../appEditCopy.ts";

/**
 * 「应用设置」弹窗里的**分类增删改查**（从 `useAppEditDialog` 拆出来，为的是守住单文件
 * 300 行：那一半管"读一次、存一次"，这一半管"分类定义本身怎么变"）。
 *
 * ## 为什么全部走既有写入路径
 *
 * 增：`buildCreateCategoryDefinitionMutations`（定义 + 标签两条，一次提交）。
 * 改：`buildSaveCategoryLabelOverrideMutations` / `buildSaveCategoryColorOverrideMutations`
 *     （映射页写分类色/名用的就是这两个，本轮只把它们从 `classificationStore` 导出）。
 * 删：`buildDeleteCategoryBatchMutations` —— **一定要用整批**：成员回落（含 web 域回落）
 *     与四条定义清理必须在同一个事务里。只清定义不清成员的下场，是本仓踩过的坑：
 *     被删的自定义分类会因为"某个域名还指着它"在下一次 bootstrap 里**原地复活**。
 *
 * ## 权限
 *
 * 写走 `platform/persistence/classificationSettingsGateway`（`cmd_commit_classification_settings`），
 * 分析窗一直有这条命令的权限。**不新增 IPC 命令**（insight 命令数被 contract 门禁钉着）。
 */
/** 带颜色的分类候选（分类管理区要画色块，`buildQuickClassificationCategoryOptions` 不带色） */
export interface AppEditCategoryOption extends QuickClassificationCategoryOption {
  color: string;
}

interface Params {
  categoryOptions: readonly AppEditCategoryOption[];
  categoryUsage: Readonly<Record<string, number>>;
  /** 重新读一份 bootstrap 并刷新候选 / 用量（由父 hook 提供，含缓存作废） */
  refreshBootstrap: () => Promise<void>;
  /** 新建成功的分类：父 hook 负责顺手勾进草稿 */
  onCreated: (category: UserAssignableAppCategory) => void;
  /** 删除成功的分类：父 hook 负责从草稿里摘掉 */
  onDeleted: (category: AppCategory) => void;
  onError: (message: string | null) => void;
  onManagingChange: (busy: boolean) => void;
}

export interface AppEditCategoryAdminState {
  createCategory: () => Promise<void>;
  renameCategory: (category: AppCategory, label: string) => Promise<void>;
  /** [修复 D-5] `null` = 恢复默认色（写 `value: null`），不是"什么也不做" */
  recolorCategory: (category: AppCategory, color: string | null) => Promise<void>;
  deleteCategory: (category: AppCategory) => Promise<void>;
  /** `useQuietDialogs` 的提示框 / 确认框节点（由弹窗层渲染） */
  dialogsElement: ReturnType<typeof useQuietDialogs>["dialogs"];
}

export function useAppEditCategoryAdmin({
  categoryOptions,
  categoryUsage,
  refreshBootstrap,
  onCreated,
  onDeleted,
  onError,
  onManagingChange,
}: Params): AppEditCategoryAdminState {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = APP_EDIT_COPY[locale];
  const adminCopy = CATEGORY_ADMIN_COPY[locale];
  const dialogs = useQuietDialogs();
  /* 双击 / 连点保护：`managing` 在渲染层，闭包里读到的可能是上一帧的值 */
  const busyRef = useRef(false);

  const withManaging = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    onManagingChange(true);
    onError(null);
    try {
      await action();
    } catch {
      onError(UI_TEXT.mapping.quickSaveFailed);
    } finally {
      busyRef.current = false;
      onManagingChange(false);
    }
  }, [UI_TEXT.mapping.quickSaveFailed, onError, onManagingChange]);

  const createCategory = useCallback(() => withManaging(async () => {
    const raw = await dialogs.prompt({
      title: UI_TEXT.mapping.createCategoryTitle,
      surfaceClassName: "qp-category-create-dialog",
      placeholder: UI_TEXT.mapping.createCategoryPlaceholder,
    });
    if (!raw) return;
    const label = normalizeCategoryLabelInput(raw);
    if (!label) return;
    /* 重名**不提交**但要说一句：静默返回会被当成"点了没反应"（与快捷菜单同一口径） */
    const wanted = label.toLocaleLowerCase();
    if (categoryOptions.some((option) => option.label.trim().toLocaleLowerCase() === wanted)) {
      onError(adminCopy.duplicateName);
      return;
    }
    /* id 不许与已加载的重复：随机 id 撞上的概率极低，撞上就是两份定义共用一条 */
    const taken = new Set<string>(categoryOptions.map((option) => option.value));
    let category = createCategoryId();
    while (taken.has(category)) category = createCategoryId();
    await commitClassificationSettingMutations(buildCreateCategoryDefinitionMutations(category, label));
    await refreshBootstrap();
    onCreated(category);
  }), [
    adminCopy.duplicateName, categoryOptions, dialogs, onCreated, onError,
    refreshBootstrap, UI_TEXT, withManaging,
  ]);

  const renameCategory = useCallback((category: AppCategory, label: string) => withManaging(async () => {
    await commitClassificationSettingMutations(buildSaveCategoryLabelOverrideMutations(category, label));
    await refreshBootstrap();
  }), [refreshBootstrap, withManaging]);

  const recolorCategory = useCallback((category: AppCategory, color: string | null) => withManaging(async () => {
    /* `null` 原样交给 builder：它写 `value: null` = 删掉这条颜色覆盖 = 回到默认色 */
    await commitClassificationSettingMutations(buildSaveCategoryColorOverrideMutations(category, color));
    await refreshBootstrap();
  }), [refreshBootstrap, withManaging]);

  const deleteCategory = useCallback((category: AppCategory) => withManaging(async () => {
    const label = categoryOptions.find((option) => option.value === category)?.label ?? category;
    const confirmed = await dialogs.confirm({
      title: UI_TEXT.mapping.deleteCategoryTitle,
      description: `${UI_TEXT.mapping.deleteCategoryDetail(label)} ${adminCopy.deleteFallback} `
        + copy.usageCount(categoryUsage[category] ?? 0),
      confirmLabel: UI_TEXT.dialog.confirmDanger,
      danger: true,
    });
    if (!confirmed) return;
    const [appOverrides, webDomainOverrides] = await Promise.all([
      loadAppOverrides(),
      loadWebDomainOverrides(),
    ]);
    /* 整批提交：成员回落 + 定义清理同一事务（web 域回落也在里面） */
    await commitClassificationSettingMutations(
      buildDeleteCategoryBatchMutations(category, appOverrides, webDomainOverrides),
    );
    await refreshBootstrap();
    onDeleted(category);
  }), [
    adminCopy.deleteFallback, categoryOptions, categoryUsage, copy, dialogs,
    onDeleted, refreshBootstrap, UI_TEXT, withManaging,
  ]);

  return {
    createCategory,
    renameCategory,
    recolorCategory,
    deleteCategory,
    dialogsElement: dialogs.dialogs,
  };
}
