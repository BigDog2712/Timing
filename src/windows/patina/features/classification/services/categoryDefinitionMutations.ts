import type { ClassificationSettingMutation } from "../../../platform/persistence/classificationSettingsGateway.ts";
import {
  isExtendedCategory,
  type AppCategory,
  type ExtendedAppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { resolveCategorySet } from "../../../shared/classification/appOverrideCodec.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { buildWebDomainMappingOverride } from "../hooks/appMappingStateHelpers.ts";
import { buildQuickAppOverride } from "./quickClassification.ts";
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
 * 拿原 override 的其余字段重算一次、**只是不带被删的那个分类**，结果为空（本来就只有
 * 分类一条信息）时才写 `null` —— 语义与映射页删分类等价，而不是另发明一套。
 *
 * [修复 D-4] 应用一侧的重算必须走 `buildQuickAppOverride`（唯一重建入口）：旧的
 * `buildAppMappingOverride` 是**白名单**式重建，它的字段表里没有本轮新增的
 * `categories` / `itemBindings`，于是"在应用设置里删一个自定义分类"会把该应用的多分类
 * 集合与全部事项绑定一起静默抹掉。网页一侧仍用 `buildWebDomainMappingOverride`
 * （那里没有这两组字段）。
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
    /* 判"成员"要看**整个集合**：被删分类可能只是副分类（`categories` 里有、`category`
       不是它）。只看 `override.category` 会漏掉一半成员，被删的 id 会因为还有应用/
       域名指着它而在下一次 bootstrap 里复活。 */
    const categorySet = resolveCategorySet(override);
    if (!categorySet.includes(category as UserAssignableAppCategory)) continue;
    const remaining = categorySet.filter((value) => value !== category);
    /* [修复 D-4] 回落走**唯一重建入口** `buildQuickAppOverride`，不用旧的
       `buildAppMappingOverride`：后者的白名单里没有 `categories` / `itemBindings`，
       重算一次就把那两组静默抹掉（删一个自定义分类 → 应用同时丢掉其它分类与全部事项
       绑定，极端情形直接变"未分类"）。剩一个成员时它就是新的主分类，不再是 null。 */
    const next = buildQuickAppOverride(override, {
      category: remaining[0] ?? null,
      categories: remaining,
      /* 指向被删分类的事项回落成"跟随主分类"，不留悬空引用 */
      itemBindings: (override.itemBindings ?? []).map((binding) => (
        binding.category === category ? { itemId: binding.itemId } : binding
      )),
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
    /* [修复 D-9] builder 不认识 `siteRule`（它单独落在 `__web_site::` 上，但从草稿态到
       这里都挂在 override 对象上）。只交 `next` / `{updatedAt}` 会让归一函数判"没有
       有意义的值"→ 写成 `value: null` → 整条记录被删，用户的分组规则跟着一起消失。
       所以原样带上原记录里那些 builder 不产出的字段，只把 `category` 摘掉。 */
    const kept = override.siteRule || override.knownDomain !== undefined
      ? { ...override, ...next, category: undefined }
      : next;
    mutations.push(...buildSaveWebDomainOverrideMutations(domain, kept));
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
