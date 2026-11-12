import { useCallback, useRef, useState } from "react";

import { commitClassificationSettingMutations } from "../../../platform/persistence/classificationSettingsGateway.ts";
import {
  createCategoryId,
  isExtendedCategory,
  normalizeCategoryLabelInput,
  type AppCategory,
  type ExtendedAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { CATEGORY_ADMIN_COPY } from "../categoryAdminCopy.ts";
import { ClassificationService } from "../services/classificationService.ts";
import {
  loadAppOverrides,
  loadWebDomainOverrides,
} from "../services/classificationStore.ts";
import {
  buildCreateCategoryDefinitionMutations,
  buildDeleteCategoryBatchMutations,
} from "../services/categoryDefinitionMutations.ts";
import {
  buildQuickClassificationCategoryOptions,
  buildQuickClassificationOverride,
  saveQuickClassificationOverride,
  type QuickClassificationCategoryOption,
  type QuickClassificationOverride,
} from "../services/quickClassification.ts";
import type { QuickClassificationTarget } from "../types.ts";

/**
 * 快捷分类弹层里「新建分类 / 删除分类」的编排（[本轮]）。
 *
 * ## 为什么是一个 hook 而不是写在弹层里
 *
 * 弹层（`QuickClassificationSurface`）贴着单文件 300 行硬限、而且已经 364 行（冻结基线
 * 385，**只许减不许加**）。这个 hook 承担全部有副作用的编排 —— 提示框 / 确认框、读库、
 * 提交一批 mutation、刷新分类候选、给当前应用换分类 —— 组件那边只剩"把返回值接到按钮上"。
 *
 * ## 权限：为什么这里可以写
 *
 * 分类的写走 `platform/persistence/classificationSettingsGateway`（`cmd_commit_classification_settings`），
 * 分析窗**有这条命令的权限**，映射页一直就是这么写的。事项的写没有这条通道，
 * 所以那一边只能走 `patina:host-intent` —— 两个领域的边界不一样，别照抄。
 *
 * ## 两件事的收尾不一样（有意的）
 *
 * · **新建**：建完立刻把当前应用分到新分类（`saveQuickClassificationOverride`），
 *   并把新候选交给调用方。用户点"新建分类"时的意图就是"我要把这东西放进一个新分类"，
 *   建完还停在菜单里等他自己再点一次，等于让他确认两遍。
 * · **删除**：不关弹层、不换当前应用的分类（除非它正属于被删的那个）—— 删除是"整理清单"，
 *   用户往往要连着删几条。
 */
export interface CategoryAdminDialogs {
  prompt(options: {
    title: string;
    description?: string;
    placeholder?: string;
    surfaceClassName?: string;
  }): Promise<string | null>;
  confirm(options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;
}

export interface CategoryAdminParams {
  target: QuickClassificationTarget;
  /** 当前应用/域名的 override（改名与改分类都基于它增量构建） */
  currentOverride: QuickClassificationOverride | null;
  /** 当前候选清单：归一后的名字要在这里比一次重名，新 id 不能与已加载的重复 */
  options: readonly QuickClassificationCategoryOption[];
  dialogs: CategoryAdminDialogs;
  onOptionsChange: (options: QuickClassificationCategoryOption[]) => void;
  /** 分类已经写进账里、当前对象归属也改完了（调用方据此更新勾选与当前分类） */
  onAssigned: (override: QuickClassificationOverride | null, category: AppCategory) => void;
  onError: (message: string) => void;
}

export interface CategoryAdminState {
  createCategory: () => Promise<void>;
  deleteCategory: (category: ExtendedAppCategory) => Promise<void>;
  /** 有请求在飞（按钮据此禁用；菜单的键盘序不变，只是不可点） */
  busy: boolean;
}

export function useQuickClassificationCategoryAdmin({
  target,
  currentOverride,
  options,
  dialogs,
  onOptionsChange,
  onAssigned,
  onError,
}: CategoryAdminParams): CategoryAdminState {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = CATEGORY_ADMIN_COPY[locale];
  const [busy, setBusy] = useState(false);
  /* 双击 / 连点保护：`busy` 是给渲染用的，闭包里读到的可能是上一帧的值 */
  const busyRef = useRef(false);

  const refreshOptions = useCallback(async () => {
    /* 必须先作废缓存：bootstrap 是带缓存的（`classificationBootstrapCache`），
       不作废的话下一次拿到的还是"没有新分类"的那一份，候选列表永远不变。 */
    ClassificationService.invalidateBootstrapCache();
    const bootstrap = await ClassificationService.loadClassificationBootstrap();
    onOptionsChange(buildQuickClassificationCategoryOptions(bootstrap, UI_TEXT, locale));
  }, [UI_TEXT, locale, onOptionsChange]);

  const createCategory = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const raw = await dialogs.prompt({
        title: UI_TEXT.mapping.createCategoryTitle,
        surfaceClassName: "qp-category-create-dialog",
        placeholder: UI_TEXT.mapping.createCategoryPlaceholder,
      });
      if (!raw) return;
      const normalized = normalizeCategoryLabelInput(raw);
      if (!normalized) return;
      const wanted = normalized.toLocaleLowerCase();
      if (options.some((option) => option.label.trim().toLocaleLowerCase() === wanted)) {
        /* 重名**不提交**，但要说一句 —— 静默返回会被当成"点了没反应" */
        onError(copy.duplicateName);
        return;
      }
      /* id 不能与本次已加载的分类重复（照 `useAppMappingState` 的 while 循环）：
         `createCategoryId` 是随机的，重复概率极低，但一旦撞上就是两条分类共用一份定义。 */
      const taken = new Set<string>(options.map((option) => option.value));
      let category = createCategoryId();
      while (taken.has(category)) {
        category = createCategoryId();
      }
      await commitClassificationSettingMutations(buildCreateCategoryDefinitionMutations(category, normalized));
      await refreshOptions();
      const next = buildQuickClassificationOverride(target, currentOverride, { category });
      await saveQuickClassificationOverride(target, next);
      onAssigned(next, category);
    } catch {
      onError(UI_TEXT.mapping.quickSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [
    copy.duplicateName, currentOverride, dialogs, onAssigned, onError, options,
    refreshOptions, target, UI_TEXT,
  ]);

  const deleteCategory = useCallback(async (category: ExtendedAppCategory) => {
    /* 兜底：内置分类（含 `other` 回落目标）没有删除入口，渲染层已经不画那颗键，
       这里再挡一次，免得将来多一个入口时把 `other` 删掉。 */
    if (busyRef.current || !isExtendedCategory(category)) return;
    const label = options.find((option) => option.value === category)?.label ?? category;
    const confirmed = await dialogs.confirm({
      title: UI_TEXT.mapping.deleteCategoryTitle,
      description: `${UI_TEXT.mapping.deleteCategoryDetail(label)} ${copy.deleteFallback}`,
      confirmLabel: UI_TEXT.dialog.confirmDanger,
      danger: true,
    });
    if (!confirmed) return;

    busyRef.current = true;
    setBusy(true);
    try {
      const [appOverrides, webDomainOverrides] = await Promise.all([
        loadAppOverrides(),
        loadWebDomainOverrides(),
      ]);
      /* **一批**提交：成员回落与四条定义清理在同一个事务里，
         否则中间那一瞬会出现"分类没了、应用还指着它"。 */
      await commitClassificationSettingMutations(
        buildDeleteCategoryBatchMutations(category, appOverrides, webDomainOverrides),
      );
      await refreshOptions();
      if (currentOverride?.category === category) {
        /* 当前这个应用正属于被删分类 → 回落到「其他」（= 把 category 从 override 里去掉），
           否则行上会继续显示一个已经不存在的分类。 */
        const fallback = buildQuickClassificationOverride(target, currentOverride, { category: null });
        await saveQuickClassificationOverride(target, fallback);
        onAssigned(fallback, "other");
      }
    } catch {
      onError(UI_TEXT.mapping.quickSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [
    copy.deleteFallback, currentOverride, dialogs, onAssigned, onError, options,
    refreshOptions, target, UI_TEXT,
  ]);

  return { createCategory, deleteCategory, busy };
}
