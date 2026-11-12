import type { ClassificationSettingMutation } from "../../../platform/persistence/classificationSettingsGateway.ts";
import {
  isExtendedCategory,
  type AppCategory,
  type ExtendedAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { buildAppMappingOverride, buildWebDomainMappingOverride } from "../hooks/appMappingStateHelpers.ts";
import {
  buildDeleteCategoryDefinitionMutations,
  buildSaveAppOverrideMutations,
  buildSaveWebDomainOverrideMutations,
  CATEGORY_DEFINITION_KEY_PREFIX,
  CATEGORY_LABEL_OVERRIDE_KEY_PREFIX,
} from "./classificationStore.ts";

/**
 * [本轮] 新建自定义分类的两条 mutation（一次提交）：**定义 + 标签**。
 *
 * 键前缀从 `classificationStore.ts` 顶部引（`export const`，与 Rust
 * `models/insight/classification.rs` 的同名常量对齐），值也照它的既有形状：
 * 定义写 `String(Date.now())`（"这个 id 存在"），标签写归一后的名字。
 *
 * 为什么这两条不写在 `classificationStore.ts` 里：那条文件 651 行、冻结在 652
 * （单文件 300 行上限的棘轮只许减不许增），加一个 builder 就红。
 * 常量与"删除那四条"都还在原处复用，所以键只在一处定义。
 */
export function buildCreateCategoryDefinitionMutations(
  category: ExtendedAppCategory,
  label: string,
): ClassificationSettingMutation[] {
  return [
    { key: `${CATEGORY_DEFINITION_KEY_PREFIX}${category}`, value: String(Date.now()) },
    { key: `${CATEGORY_LABEL_OVERRIDE_KEY_PREFIX}${category}`, value: label },
  ];
}

/**
 * 快捷分类弹层的「删除分类」要提交的**一整批** mutation（[本轮]）。
 *
 * 为什么单独一个模块：这里只有纯函数（输入 = 当前落库状态，输出 = mutation 数组），
 * 所以"删一个自定义分类到底写了哪几个键、成员怎么回落"能被一条单测直接钉住；
 * 编排（读库 → 提交 → 刷新候选 → 给当前应用换分类）在
 * `hooks/useQuickClassificationCategoryAdmin.ts` 里。
 *
 * ## 成员回落为什么是"重算 override"而不是"删掉 override"
 *
 * 分类只存在于 `AppOverride.category` 这一个字段里。删掉整条 override 会连带丢掉
 * 用户给这个应用设的**别名 / 颜色 / 不追踪标题**；所以照
 * `appMappingStateHelpers.deleteCategoryFromDraftState`（映射页删分类的既有实现）的做法：
 * 用 `buildAppMappingOverride` 拿原 override 的其余字段重算一次、**只是不带 category**，
 * 结果为空（本来就只有 category 一条信息）时才写 `null` —— 语义与映射页删分类等价，
 * 而不是另发明一套。
 *
 * ## 内置分类不来这里
 *
 * 调用方必须先判 `isExtendedCategory`：内置 11 个分类可能被"隐藏"（`deletedCategories`），
 * 但**定义不能删** —— `other` 尤其不能，它是所有回落的目标。这里再挡一次，
 * 免得将来有人从别的入口把 `other` 传进来。
 */
export function buildCategoryMemberFallbackMutations(
  category: AppCategory,
  appOverrides: Readonly<Record<string, AppOverride>>,
  webDomainOverrides: Readonly<Record<string, WebDomainOverride>> = {},
): ClassificationSettingMutation[] {
  const mutations: ClassificationSettingMutation[] = [];

  for (const [exeName, override] of Object.entries(appOverrides)) {
    if (override.category !== category) continue;
    const next = buildAppMappingOverride({
      category: undefined,
      color: override.color,
      displayName: override.displayName,
      track: override.track !== false,
      captureTitle: override.captureTitle !== false,
      updatedAt: override.updatedAt,
    });
    mutations.push(...buildSaveAppOverrideMutations(exeName, next));
  }

  /* 网页成员同一套回落。分类候选（`buildQuickClassificationCategoryOptions`）也会从
     `loadedWebDomainOverrides` 里收集自定义分类 —— 只清应用成员的话，被删掉的分类会
     因为某个域名还指着它而在下一次 bootstrap 里**原地复活**。 */
  for (const [domain, override] of Object.entries(webDomainOverrides)) {
    if (override.category !== category) continue;
    const next = buildWebDomainMappingOverride({
      category: undefined,
      color: override.color,
      displayName: override.displayName,
      enabled: override.enabled !== false,
      captureTitle: override.captureTitle !== false,
      updatedAt: override.updatedAt,
    });
    if (next || override.siteRule || override.knownDomain !== undefined) {
      mutations.push(...buildSaveWebDomainOverrideMutations(
        domain,
        next ?? { updatedAt: override.updatedAt ?? Date.now() },
      ));
      continue;
    }
    mutations.push(...buildSaveWebDomainOverrideMutations(domain, null));
  }

  return mutations;
}

/**
 * 删除一个**自定义**分类的完整批次 = 成员回落 + 四条定义清理。
 *
 * 一次 `commitClassificationSettingMutations` 提交整批（Rust 侧是同一个事务）：
 * 分两批提交的话，中间那一瞬会出现"分类没了、应用还指着它"的状态，
 * 读侧（`buildQuickClassificationCategoryOptions`）会把一个不存在的分类画成选项。
 */
export function buildDeleteCategoryBatchMutations(
  category: AppCategory,
  appOverrides: Readonly<Record<string, AppOverride>>,
  webDomainOverrides: Readonly<Record<string, WebDomainOverride>> = {},
): ClassificationSettingMutation[] {
  if (!isExtendedCategory(category)) {
    return [];
  }
  return [
    ...buildCategoryMemberFallbackMutations(category, appOverrides, webDomainOverrides),
    ...buildDeleteCategoryDefinitionMutations(category),
  ];
}
