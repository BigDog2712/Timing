import {
  getCategoryToken,
  isExtendedCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import {
  normalizeCategorySet,
  normalizeItemBindings,
  type AppItemCategoryBinding,
} from "../../../shared/classification/appOverrideCodec.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";
import {
  ClassificationService,
  type ClassificationBootstrapData,
} from "./classificationService.ts";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import type { QuickClassificationTarget } from "../types.ts";

export interface QuickClassificationCategoryOption {
  value: UserAssignableAppCategory;
  label: string;
}

interface QuickClassificationOverridePatch {
  category?: UserAssignableAppCategory | null;
  displayName?: string | null;
  /** [本轮] 多选分类集合；[0] 会自动成为 `category`（主分类），两者永远一起写 */
  categories?: readonly UserAssignableAppCategory[] | null;
  /** [本轮] 事项 → 归属分类的绑定清单；`[]` / `null` 都表示"清空绑定" */
  itemBindings?: readonly AppItemCategoryBinding[] | null;
}

export type QuickClassificationOverride = AppOverride | WebDomainOverride;

export function isQuickClassificationUnclassified(
  category: AppCategory | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): boolean {
  return !category || category === "other" || deletedCategories.includes(category);
}

/**
 * 应用 override 的**唯一重建入口**（白名单式重建，`current` 里没列进来的字段会被丢掉，
 * 所以每加一个字段都必须同时加到这里 —— 这是本轮最容易踩的坑）。
 *
 * [本轮] 两条不变式在这里强制：
 *   ① `category` 恒等于 `categories[0]`。只改主分类的补丁（快捷菜单那条路）会把它提到集合
 *      首位、其余分类保留（不静默丢数据）；只改集合的补丁（应用设置弹窗）由集合首项决定主分类。
 *   ② 清空主分类 = 连集合一起清空。留着 `categories` 而 `category` 为空会读出一个
 *      "既属于某些分类、又没有主分类"的状态，等于让两个读侧各有一套真相。
 *
 * [修复 D-3] 「其他」是"未分类"的**指令**，不是集合里的成员。快捷菜单点「其他」传的是
 * `{ category: "other" }`：旧实现把它当成真分类塞进集合首位，落盘时 `other` 又被
 * `serializeAppOverride` 剔掉，读回来就变成 `category="other"` 而 `categories[0]` 是旧分类
 * —— 用户再打开弹窗看到主分类还是原来那个。现在把「其他」归一成"清空主分类 + 清空集合"，
 * 于是写回的就是一条真正"未分类"的 override（其余字段为空时整条置 null，不留僵尸记录）。
 */
export function buildQuickAppOverride(
  current: AppOverride | null,
  patch: QuickClassificationOverridePatch,
  updatedAt: number = Date.now(),
): AppOverride | null {
  const patchHasCategory = Object.prototype.hasOwnProperty.call(patch, "category");
  const patchHasCategories = Object.prototype.hasOwnProperty.call(patch, "categories");
  const requestedCategory = patchHasCategory ? patch.category ?? undefined : current?.category;
  /* "写未分类"只认**补丁显式**要求的那一次。读到一个历史遗留的 `category: "other"`
     （D-3 之前的落盘结果）时只把它归一成"没有主分类"，集合原样留着 ——
     否则一次无关的编辑（比如只改别名）会顺手把用户的分类全清掉。 */
  const unclassify = patchHasCategory && requestedCategory === "other";
  const category = requestedCategory === "other" ? undefined : requestedCategory;
  const displayName = Object.prototype.hasOwnProperty.call(patch, "displayName")
    ? patch.displayName ?? undefined
    : current?.displayName;
  const categories = unclassify && !patchHasCategories
    ? undefined
    : patchHasCategories ? patch.categories ?? undefined : current?.categories;
  const itemBindings = Object.prototype.hasOwnProperty.call(patch, "itemBindings")
    ? patch.itemBindings ?? undefined
    : current?.itemBindings;

  const primary = patchHasCategory ? category : categories?.[0] ?? category;
  const seed = primary ? normalizeCategorySet(categories, primary) : [];
  const resolvedCategories = primary && seed[0] !== primary
    ? [primary, ...seed.filter((value) => value !== primary)]
    : seed;
  const resolvedBindings = normalizeItemBindings(itemBindings);

  const next: AppOverride = { enabled: true, updatedAt };
  if (resolvedCategories.length > 0) {
    next.category = resolvedCategories[0];
    next.categories = resolvedCategories;
  }
  if (resolvedBindings.length > 0) next.itemBindings = resolvedBindings;
  if (displayName?.trim()) next.displayName = displayName.trim();
  if (current?.color) next.color = current.color;
  if (current?.track === false) next.track = false;
  if (current?.captureTitle === false) next.captureTitle = false;
  const hasMeaningfulOverride = Boolean(
    next.category
    || next.itemBindings
    || next.displayName
    || next.color
    || next.track === false
    || next.captureTitle === false,
  );
  return hasMeaningfulOverride ? next : null;
}

export function buildQuickWebDomainOverride(
  current: WebDomainOverride | null,
  patch: QuickClassificationOverridePatch,
  updatedAt: number = Date.now(),
): WebDomainOverride | null {
  const category = Object.prototype.hasOwnProperty.call(patch, "category")
    ? patch.category ?? undefined
    : current?.category;
  const displayName = Object.prototype.hasOwnProperty.call(patch, "displayName")
    ? patch.displayName ?? undefined
    : current?.displayName;

  const next: WebDomainOverride = { updatedAt };
  if (current?.siteRule) next.siteRule = current.siteRule;
  if (current?.knownDomain !== undefined) next.knownDomain = current.knownDomain;
  if (category && category !== "other") next.category = category;
  if (displayName?.trim()) next.displayName = displayName.trim();
  if (current?.color) next.color = current.color;
  if (current?.enabled === false) next.enabled = false;
  if (current?.captureTitle === false) next.captureTitle = false;
  const hasMeaningfulOverride = Boolean(
    next.category
    || next.displayName
    || next.color
    || next.enabled === false
    || next.captureTitle === false || next.siteRule,
  );
  return hasMeaningfulOverride ? next : null;
}

export function resolveQuickClassificationOverride(
  bootstrap: Pick<ClassificationBootstrapData, "loadedOverrides" | "loadedWebDomainOverrides">,
  target: QuickClassificationTarget,
): QuickClassificationOverride | null {
  if (target.kind === "web") {
    return bootstrap.loadedWebDomainOverrides[target.normalizedDomain] ?? null;
  }

  const canonicalExe = resolveCanonicalExecutable(target.exeName);
  return bootstrap.loadedOverrides[canonicalExe]
    ?? bootstrap.loadedOverrides[target.exeName]
    ?? null;
}

export function buildQuickClassificationOverride(
  target: QuickClassificationTarget,
  current: QuickClassificationOverride | null,
  patch: QuickClassificationOverridePatch,
  updatedAt: number = Date.now(),
): QuickClassificationOverride | null {
  return target.kind === "app"
    ? buildQuickAppOverride(current as AppOverride | null, patch, updatedAt)
    : buildQuickWebDomainOverride(current as WebDomainOverride | null, patch, updatedAt);
}

export async function saveQuickClassificationOverride(
  target: QuickClassificationTarget,
  override: QuickClassificationOverride | null,
): Promise<void> {
  if (target.kind === "app") {
    await ClassificationService.saveAppOverride(
      target.exeName,
      override as AppOverride | null,
    );
    return;
  }
  await ClassificationService.saveWebDomainOverride(
    target.normalizedDomain,
    override as WebDomainOverride | null,
  );
}

export function buildQuickClassificationCategoryOptions(
  bootstrap: Pick<
    ClassificationBootstrapData,
    | "loadedOverrides"
    | "loadedWebDomainOverrides"
    | "loadedCategoryColorOverrides"
    | "loadedCategoryLabelOverrides"
    | "loadedPersistedCategoryIds"
    | "loadedDeletedCategories"
  >,
  uiText: UiText,
  locale: Locale,
): QuickClassificationCategoryOption[] {
  const deleted = new Set<AppCategory>(bootstrap.loadedDeletedCategories);
  const extended = new Set<UserAssignableAppCategory>();
  const collectExtended = (category: AppCategory | undefined) => {
    if (category && isExtendedCategory(category) && !deleted.has(category)) {
      extended.add(category);
    }
  };

  bootstrap.loadedPersistedCategoryIds.forEach(collectExtended);
  Object.values(bootstrap.loadedOverrides).forEach((override) => collectExtended(override.category));
  Object.values(bootstrap.loadedWebDomainOverrides).forEach((override) => collectExtended(override.category));
  Object.keys(bootstrap.loadedCategoryColorOverrides).forEach((category) => {
    collectExtended(category as AppCategory);
  });

  const resolveLabel = (category: UserAssignableAppCategory) => (
    bootstrap.loadedCategoryLabelOverrides[category] ?? getCategoryToken(category, uiText).label
  );
  const seeded = USER_ASSIGNABLE_CATEGORIES.filter(
    (category) => category !== "other" && !deleted.has(category),
  );
  const custom = Array.from(extended).sort((left, right) => (
    resolveLabel(left).localeCompare(resolveLabel(right), locale)
  ));
  const ordered = deleted.has("other")
    ? [...seeded, ...custom]
    : [...seeded, ...custom, "other" as const];

  return ordered.map((category) => ({ value: category, label: resolveLabel(category) }));
}
