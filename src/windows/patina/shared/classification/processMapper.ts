import {
  getCategoryToken,
  isAppCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
} from "./categoryTokens.ts";
import { resolveCanonicalExecutable, shouldTrackProcess } from "./processNormalization.ts";
import { CategoryColorRegistry } from "./categoryColorRegistry.ts";
import { formatExecutableFallbackName } from "./executableDisplayName.ts";
import {
  normalizeAppOverride,
  parseAppOverride,
  resolveCategorySet,
  serializeAppOverride,
  type AppOverrideShape,
} from "./appOverrideCodec.ts";
import type { UiText } from "../i18n/index.ts";

export interface MappingHints {
  appName?: string;
}

/**
 * 应用 override 的全部字段（形状定义在 `appOverrideCodec.ts`）。
 *
 * 本轮新增两组字段，语义见 codec 顶部注释：
 *   · `categories`   —— 该应用允许归属的分类集合，`[0]` 与 `category` 相同（主分类）；
 *   · `itemBindings` —— 已绑定的事项，各自可指定归属分类。
 * 之所以用 `type` 而不是再抄一遍 `interface`：字段形状只能有一个真相源，
 * 抄第二份的下场是"写盘认得、读盘不认得"。
 */
export type AppOverride = AppOverrideShape;

export interface AppInfo {
  name: string;
  category: AppCategory;
  color: string;
}

function normalizeDisplayName(name: string | undefined) {
  return (name ?? "").trim().replace(/\.exe$/i, "");
}

function normalizeCategoryLabelOverrides(
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!overrides) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [category, label] of Object.entries(overrides)) {
    if (!isAppCategory(category) || category === "system" || category === "other") {
      continue;
    }
    const trimmed = label.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      continue;
    }
    normalized[category] = trimmed;
  }
  return normalized;
}

export class ProcessMapper {
  private static userOverrides: Record<string, AppOverride> = {};
  private static categoryColors = new CategoryColorRegistry();
  private static categoryLabelOverrides: Record<string, string> = {};

  static getUserAssignableCategories() {
    return [...USER_ASSIGNABLE_CATEGORIES];
  }

  static setDeletedCategories(categories: AppCategory[]) {
    this.categoryColors.setDeletedCategories(categories);
  }

  static getDeletedCategories(): AppCategory[] {
    return this.categoryColors.getDeletedCategories();
  }

  static isCategoryDeleted(category: AppCategory): boolean {
    return this.categoryColors.isCategoryDeleted(category);
  }

  static getCategoryLabel(category: AppCategory, uiText: UiText) {
    return this.categoryLabelOverrides[category] ?? getCategoryToken(category, uiText).label;
  }

  static getCategoryLabelOverride(category: AppCategory): string | null {
    return this.categoryLabelOverrides[category] ?? null;
  }

  static setCategoryLabelOverrides(overrides: Record<string, string>) {
    this.categoryLabelOverrides = normalizeCategoryLabelOverrides(overrides);
  }

  static setCategoryLabelOverride(category: AppCategory, label?: string | null) {
    const normalized = normalizeCategoryLabelOverrides({ [category]: label ?? "" });
    const nextLabel = normalized[category];
    if (!nextLabel) {
      delete this.categoryLabelOverrides[category];
      return;
    }
    this.categoryLabelOverrides[category] = nextLabel;
  }

  static clearCategoryLabelOverrides() {
    this.categoryLabelOverrides = {};
  }

  static getCategoryColor(category: AppCategory) {
    return this.categoryColors.getCategoryColor(category);
  }

  static getDefaultCategoryColor(category: AppCategory) {
    return this.categoryColors.getDefaultCategoryColor(category);
  }

  static getCategoryColorOverride(category: AppCategory): string | null {
    return this.categoryColors.getCategoryColorOverride(category);
  }

  static setCategoryColorOverrides(overrides: Record<string, string>) {
    this.categoryColors.setCategoryColorOverrides(overrides);
  }

  static setCategoryColorOverride(category: AppCategory, colorValue?: string | null) {
    this.categoryColors.setCategoryColorOverride(category, colorValue);
  }

  static clearCategoryColorOverrides() {
    this.categoryColors.clearCategoryColorOverrides();
  }

  static setCategoryDefaultColorAssignments(assignments: Record<string, string>) {
    this.categoryColors.setCategoryDefaultColorAssignments(assignments);
  }

  static setCategoryDefaultColorAssignmentPersistence(
    handler: ((category: AppCategory, colorValue: string | null) => Promise<void>) | null,
  ) {
    this.categoryColors.setCategoryDefaultColorAssignmentPersistence(handler);
  }

  static async removeCategoryDefaultColorAssignment(category: AppCategory) {
    await this.categoryColors.removeCategoryDefaultColorAssignment(category);
  }

  static setUserOverrides(overrides: Record<string, AppOverride>) {
    const normalized: Record<string, AppOverride> = {};
    for (const [exeName, override] of Object.entries(overrides)) {
      const canonicalExe = resolveCanonicalExecutable(exeName);
      if (!canonicalExe) continue;

      const safeOverride = normalizeAppOverride(override);
      if (!safeOverride) continue;
      normalized[canonicalExe] = safeOverride;
    }
    this.userOverrides = normalized;
  }

  static setUserOverride(exeName: string, override: AppOverride | null) {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    if (!canonicalExe) return;

    const safeOverride = normalizeAppOverride(override);
    if (!safeOverride) {
      delete this.userOverrides[canonicalExe];
      return;
    }

    this.userOverrides[canonicalExe] = safeOverride;
  }

  static clearUserOverrides() {
    this.userOverrides = {};
  }

  static getUserOverride(exeName: string): AppOverride | null {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.userOverrides[canonicalExe] ?? null;
  }

  /**
   * 该应用**当前生效**的分类集合（多选；`[0]` = 主分类）。已删除的自定义分类会被过滤掉，
   * 过滤后为空回落到 `category`。界面要"这个应用属于哪些分类"一律走这里，别自己写三元。
   */
  static getAppCategorySet(exeName: string): AppCategory[] {
    const override = this.getUserOverride(exeName);
    return resolveCategorySet(override, this.getDeletedCategories());
  }

  private static mapWithOverride(exeName: string, hints: MappingHints, override: AppOverride | null | undefined): AppInfo {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    const fallbackName = formatExecutableFallbackName(canonicalExe) || canonicalExe;
    const resolvedName = override?.displayName || normalizeDisplayName(hints.appName) || fallbackName;
    const rawCategory = override?.category ?? "other";
    const resolvedCategory = this.categoryColors.resolveActiveCategory(rawCategory);

    return {
      name: resolvedName,
      category: resolvedCategory,
      color: override?.color ?? this.categoryColors.getCategoryColor(resolvedCategory),
    };
  }

  static map(exeName: string, hints: MappingHints = {}): AppInfo {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.mapWithOverride(exeName, hints, this.userOverrides[canonicalExe]);
  }

  static mapWithoutOverride(exeName: string, hints: MappingHints = {}): AppInfo {
    return this.mapWithOverride(exeName, hints, null);
  }

  static isTrackingEnabledByUser(exeName: string): boolean {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.userOverrides[canonicalExe]?.track !== false;
  }

  static shouldTrack(exeName: string): boolean {
    if (!shouldTrackProcess(exeName)) {
      return false;
    }

    return this.isTrackingEnabledByUser(exeName);
  }

  static toOverrideStorageValue(override: AppOverride) {
    return serializeAppOverride(override);
  }

  static fromOverrideStorageValue(rawValue: string): AppOverride | null {
    return parseAppOverride(rawValue);
  }
}
