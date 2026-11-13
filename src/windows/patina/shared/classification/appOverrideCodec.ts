/**
 * 应用 override 的"形状 + 归一 + 存取编码"（[本轮] 从 `processMapper.ts` 按语义搬出来）
 * -----------------------------------------------------------------------------
 * 为什么搬：《数据 → 应用趋势》本轮要给 override 加「多个分类」与「多个事项绑定」两组
 * 字段，`processMapper.ts` 正卡在单文件 300 行上限的冻结基线上（只许减不许加）。
 * 这三块（字段形状 / 归一 / storage 编解码）本来就是"纯数据"，与 `ProcessMapper` 的
 * 静态注册表没有关系，搬出来之后两边都有余量，也不会有人再往 mapper 里加一个三元。
 *
 * ## 字段语义（`AppOverride` 的三条不变式）
 *
 * 1. **`category` 仍然是唯一真相的主分类**，`categories[0]` 必须与它相等。
 *    这样后端（`tracker_settings.rs` 的 `StoredAppOverride`）与所有"按分类聚合"的老逻辑
 *    **零改动**：它们只读 `category`；多选只是前端多存了一组字段。
 *    老数据（只有 `category`）读出来就是 `categories: []`，`resolveCategorySet()` 会把它
 *    归一成 `[category]` —— **不需要迁移脚本**。
 * 2. **`categories` 里不出现 `other`**。"其他"在本仓的语义是"未分类"（
 *    `buildQuickAppOverride` 一直把 `category === "other"` 当"没有分类"写回），
 *    让 `other` 混进多选集合会出现"既在集合里又被当成未分类"的两种真相。
 * 3. **`itemBindings` 是"事项 → 归属分类"的配置**，本轮只存不用（不做自动归因、不参与
 *    统计聚合），只把数据落到 override 里。
 */

// TODO(下一轮)：事项时间区间改写应用分类的统计聚合。
// 现状：条目在应用趋势里只是"配置"，后端 `cmd_get_app_trend` 仍按窗口时长整体归到
// `category`（主分类）；用户把某个事项绑到副分类后，那段时间的时长**不会**挪到副分类，
// 所以"应用选了 A+B、事项绑到 B"时统计口径与展示不一致。要一致就必须让后端读这张
// 配置表并按时段切分重算 —— 涉及 Rust 侧聚合与 schema 口径，本轮明确不做。
import {
  USER_ASSIGNABLE_CATEGORIES,
  isExtendedCategory,
  normalizeExtendedCategory,
  type AppCategory,
  type UserAssignableAppCategory,
} from "./categoryTokens.ts";

/** 一个应用可以绑多个事项；每个事项可以指定"这件事属于哪个分类"（不指定 = 跟随主分类） */
export interface AppItemCategoryBinding {
  itemId: number;
  category?: UserAssignableAppCategory;
}

/** `__app_override::<exe>` 里那条 JSON 的形状（与 Rust `StoredAppOverride` 的前缀兼容） */
export interface AppOverrideShape {
  category?: UserAssignableAppCategory;
  /** 该应用允许归属的分类集合，`[0]` = 主分类（= `category`） */
  categories?: UserAssignableAppCategory[];
  /** 已绑定的事项 → 各自归属的分类 */
  itemBindings?: AppItemCategoryBinding[];
  displayName?: string;
  color?: string;
  track?: boolean;
  captureTitle?: boolean;
  enabled?: boolean;
  updatedAt?: number;
}

const USER_ASSIGNABLE_CATEGORY_SET = new Set<string>(USER_ASSIGNABLE_CATEGORIES);

function normalizeHexColor(color: string | undefined): string | null {
  const raw = (color ?? "").trim();
  if (!raw) return null;

  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

function normalizeUserAssignableCategory(category: string | undefined): UserAssignableAppCategory | null {
  const normalized = (category ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (isExtendedCategory(normalized)) {
    return normalizeExtendedCategory(normalized);
  }

  if (USER_ASSIGNABLE_CATEGORY_SET.has(normalized)) {
    return normalized as UserAssignableAppCategory;
  }

  return null;
}

/**
 * 集合归一：逐项校验 → 去重 → 丢掉 `other`；空集合回落到 `fallbackCategory`。
 *
 * 回落的理由：`category` 是唯一真相。只要 `category` 有值，`categories` 就不该是空数组
 * （否则 UI 上"这个应用属于某个分类"与"它没有任何分类"会同时成立）。
 */
export function normalizeCategorySet(
  values: readonly string[] | undefined,
  fallbackCategory?: string,
): UserAssignableAppCategory[] {
  const seen = new Set<string>();
  const normalized: UserAssignableAppCategory[] = [];
  for (const value of values ?? []) {
    const category = normalizeUserAssignableCategory(value);
    if (!category || category === "other" || seen.has(category)) continue;
    seen.add(category);
    normalized.push(category);
  }
  if (normalized.length > 0) return normalized;

  const fallback = normalizeUserAssignableCategory(fallbackCategory);
  return fallback && fallback !== "other" ? [fallback] : [];
}

/**
 * **读侧的唯一入口**：`categories` 缺失时视作 `[category]`，被删掉的自定义分类过滤掉，
 * 过滤后为空再回落到 `category`。
 *
 * 为什么必须有这一个函数：多选集合会被三处读（弹窗草稿、行上的标记、分类管理区的用量
 * 统计），三处各写一遍三元，就一定会有一处漏掉"已删分类"这一条，然后被删掉的分类
 * 在界面上复活（`buildCategoryMemberFallbackMutations` 的注释里记着同一个坑）。
 */
export function resolveCategorySet(
  override: Pick<AppOverrideShape, "category" | "categories"> | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): UserAssignableAppCategory[] {
  const deleted = new Set<string>(deletedCategories);
  const declared = normalizeCategorySet(override?.categories, override?.category)
    .filter((category) => !deleted.has(category));
  if (declared.length > 0) return declared;

  const fallback = normalizeUserAssignableCategory(override?.category);
  return fallback && fallback !== "other" && !deleted.has(fallback) ? [fallback] : [];
}

/**
 * 事项绑定的归一：丢掉非法 id（非正整数）与重复项，`category` 非法就当"跟随主分类"。
 *
 * 注意"分类被删了"与"绑定非法"不是一回事：分类被删时由删除批次的成员回落
 * （`buildCategoryMemberFallbackMutations`）把这条绑定的 `category` 摘掉、**绑定本身保留**
 * —— 也就是降级成"跟随主分类"，而不是把绑定丢弃。所以这里不需要认识"已删分类"，
 * 只认 token 形状即可。
 */
export function normalizeItemBindings(
  bindings: readonly AppItemCategoryBinding[] | undefined,
): AppItemCategoryBinding[] {
  const seen = new Set<number>();
  const normalized: AppItemCategoryBinding[] = [];
  for (const binding of bindings ?? []) {
    const itemId = binding?.itemId;
    if (typeof itemId !== "number" || !Number.isSafeInteger(itemId) || itemId <= 0) continue;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const category = normalizeUserAssignableCategory(binding.category);
    normalized.push(category && category !== "other" ? { itemId, category } : { itemId });
  }
  return normalized;
}

/**
 * override 归一。与旧实现的差别只有一处：`categories` / `itemBindings` 一并保留
 * （旧实现是白名单式重建，漏掉的字段会被**静默抹掉** —— 那正是"在弹窗里改了分类，
 * 保存时把事项绑定整段清空"这类事故的成因）。
 */
export function normalizeAppOverride(
  override: AppOverrideShape | null | undefined,
): AppOverrideShape | null {
  if (!override) return null;
  if (override.enabled === false) return null;

  const normalized: AppOverrideShape = {};

  const normalizedCategory = normalizeUserAssignableCategory(override.category);
  if (normalizedCategory) {
    normalized.category = normalizedCategory;
  }
  if (override.displayName?.trim()) {
    normalized.displayName = override.displayName.trim();
  }
  const color = normalizeHexColor(override.color);
  if (color) {
    normalized.color = color;
  }
  if (override.track === false) {
    normalized.track = false;
  }
  if (override.captureTitle === false) {
    normalized.captureTitle = false;
  }
  if (typeof override.updatedAt === "number" && Number.isFinite(override.updatedAt)) {
    normalized.updatedAt = override.updatedAt;
  }
  const categories = normalizeCategorySet(override.categories, normalized.category);
  if (categories.length > 0) {
    normalized.categories = categories;
  }
  const itemBindings = normalizeItemBindings(override.itemBindings);
  if (itemBindings.length > 0) {
    normalized.itemBindings = itemBindings;
  }
  normalized.enabled = true;

  const hasMeaningfulOverride = Boolean(
    normalized.category
    || normalized.categories
    || normalized.itemBindings
    || normalized.displayName
    || normalized.color
    || normalized.track === false
    || normalized.captureTitle === false,
  );

  return hasMeaningfulOverride ? normalized : null;
}

/**
 * 写盘的唯一实现。**新字段必须一起写**：`categories` 与 `itemBindings` 漏在这里，
 * 就等于"存一次丢一次"（`normalizeOverride` 认得它们，但序列化不写）。
 */
export function serializeAppOverride(override: AppOverrideShape): string {
  return JSON.stringify({
    category: override.category ?? null,
    displayName: override.displayName ?? null,
    color: normalizeHexColor(override.color) ?? null,
    track: override.track !== false,
    captureTitle: override.captureTitle !== false,
    enabled: override.enabled !== false,
    updatedAt: override.updatedAt ?? Date.now(),
    categories: normalizeCategorySet(override.categories, override.category),
    itemBindings: normalizeItemBindings(override.itemBindings),
  });
}

export function parseAppOverride(rawValue: string): AppOverrideShape | null {
  if (!rawValue.trim()) return null;
  try {
    return normalizeAppOverride(JSON.parse(rawValue) as AppOverrideShape);
  } catch {
    return null;
  }
}
