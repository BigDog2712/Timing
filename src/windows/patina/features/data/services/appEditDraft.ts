import type { AppCategory, UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import {
  normalizeItemBindings,
  resolveCategorySet,
  type AppItemCategoryBinding,
} from "../../../shared/classification/appOverrideCodec.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { buildQuickAppOverride } from "../../classification/services/quickClassification.ts";

/**
 * 「应用设置」弹窗的**草稿模型**（纯函数，零副作用）。
 *
 * 为什么单独一层：这个弹窗要同时管 3 类状态（多选分类、多选事项、每个事项的归属分类），
 * 还要能在关闭时整体丢弃。把"改草稿"写成 `useState` 里散着 `setXxx([...])`，则
 * "取消勾选某个分类之后，指着它的那些事项怎么办"这类联动会散在 6 个回调里，
 * 每个都要单独想一遍——而它们本来就该是同一个函数的一部分。
 *
 * 三层职责划清：
 *   · 本文件：草稿怎么变（纯函数，可单测）
 *   · `hooks/useAppEditDialog.ts`：读写编排（加载 / 保存 / 失败提示）
 *   · `components/DataAppEdit*.tsx`：只画
 */

export interface AppEditDraft {
  /** 已勾选的分类，`[0]` = 主分类（写回时同值落到 `category`） */
  categories: UserAssignableAppCategory[];
  /** 已绑定的事项；`category` 缺省 = 跟随主分类 */
  itemBindings: AppItemCategoryBinding[];
}

const EMPTY_DRAFT: AppEditDraft = { categories: [], itemBindings: [] };

/**
 * 落库的 override → 草稿。读侧统一走 `resolveCategorySet`（它负责"`categories` 缺失就
 * 视作 `[category]`"与"已删分类过滤掉"），**不许在这里再写一遍三元**。
 */
export function createAppEditDraft(
  override: AppOverride | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): AppEditDraft {
  if (!override) return { ...EMPTY_DRAFT };
  return {
    categories: resolveCategorySet(override, deletedCategories),
    itemBindings: normalizeItemBindings(override.itemBindings),
  };
}

/**
 * 勾选 / 取消勾选一个分类。
 *
 * 取消勾选会**连带**把指向它的那些事项的归属清空（回落到"跟随主分类"）：留着
 * `itemBindings[].category = 已取消的分类` 会让读侧看到一个不在集合里的分类，
 * 那是下一次"分类又冒出来了"的来源。
 */
export function toggleDraftCategory(
  draft: AppEditDraft,
  category: UserAssignableAppCategory,
): AppEditDraft {
  const checked = draft.categories.includes(category);
  const categories = checked
    ? draft.categories.filter((value) => value !== category)
    : [...draft.categories, category];
  return keepItemCategoriesWithin(categories, draft.itemBindings);
}

/** 把某个已勾选的分类提为「主分类」（提到首位）。未勾选时先勾上再提。 */
export function promoteDraftCategory(
  draft: AppEditDraft,
  category: UserAssignableAppCategory,
): AppEditDraft {
  const rest = draft.categories.filter((value) => value !== category);
  return { categories: [category, ...rest], itemBindings: draft.itemBindings };
}

/** 勾选 / 取消勾选一个事项（取消 = 连它的归属分类一起丢掉，不留孤儿） */
export function toggleDraftItem(draft: AppEditDraft, itemId: number): AppEditDraft {
  const bound = draft.itemBindings.some((binding) => binding.itemId === itemId);
  return {
    categories: draft.categories,
    itemBindings: bound
      ? draft.itemBindings.filter((binding) => binding.itemId !== itemId)
      : [...draft.itemBindings, { itemId }],
  };
}

/**
 * 给某个已绑定的事项指定归属分类（`undefined` = 跟随主分类）。
 * 事项还没勾上时顺手勾上——下拉框只对已勾选的行出现，这个分支防御脏调用。
 */
export function assignDraftItemCategory(
  draft: AppEditDraft,
  itemId: number,
  category: UserAssignableAppCategory | undefined,
): AppEditDraft {
  const exists = draft.itemBindings.some((binding) => binding.itemId === itemId);
  const nextBindings = exists
    ? draft.itemBindings.map((binding) => (
      binding.itemId === itemId
        ? (category ? { itemId, category } : { itemId })
        : binding
    ))
    : [...draft.itemBindings, category ? { itemId, category } : { itemId }];
  return { categories: draft.categories, itemBindings: nextBindings };
}

/** 把事项归属里"不在 `categories` 里"的那些清掉（回落成跟随主分类） */
export function keepItemCategoriesWithin(
  categories: readonly UserAssignableAppCategory[],
  itemBindings: readonly AppItemCategoryBinding[],
): AppEditDraft {
  const allowed = new Set<string>(categories);
  return {
    categories: [...categories],
    itemBindings: normalizeItemBindings(itemBindings).map((binding) => (
      binding.category && !allowed.has(binding.category)
        ? { itemId: binding.itemId }
        : binding
    )),
  };
}

/** 草稿与落库态是否不同（关闭前要不要提示、保存键要不要亮，都看这一个） */
export function isDraftDirty(
  draft: AppEditDraft,
  override: AppOverride | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): boolean {
  const persisted = createAppEditDraft(override, deletedCategories);
  return JSON.stringify(persisted) !== JSON.stringify({
    categories: draft.categories,
    itemBindings: normalizeItemBindings(draft.itemBindings),
  });
}

/**
 * 草稿 → 写回用的 override。
 *
 * `category` **必须**跟着集合一起传（哪怕它等于 `categories[0]`）：`buildQuickAppOverride`
 * 用"补丁里有没有 `category` 这个键"区分"只改集合"和"只改主分类"。只传集合时它会
 * 拿 `current.category` 当回落值，于是"取消勾选全部分类"会被它按老规则又补回来。
 */
export function buildDraftAppOverride(
  current: AppOverride | null,
  draft: AppEditDraft,
  updatedAt: number = Date.now(),
): AppOverride | null {
  return buildQuickAppOverride(current, {
    category: draft.categories[0] ?? null,
    categories: draft.categories,
    itemBindings: draft.itemBindings,
  }, updatedAt);
}

/**
 * 每个分类被多少个应用 / 域名指着（分类管理区的"影响面"读数）。
 *
 * 数据全部来自已加载的 override 集合，**不新增后端查询**：弹窗打开时 bootstrap 里
 * 已经有两张表了，再为一行数字跑一次 IPC 不值得。
 */
export function collectCategoryUsage(
  appOverrides: Readonly<Record<string, AppOverride>>,
  webDomainOverrides: Readonly<Record<string, WebDomainOverride>> = {},
): Record<string, number> {
  const usage: Record<string, number> = {};
  const record = (categories: readonly string[]) => {
    for (const category of categories) {
      usage[category] = (usage[category] ?? 0) + 1;
    }
  };
  for (const override of Object.values(appOverrides)) record(resolveCategorySet(override));
  for (const override of Object.values(webDomainOverrides)) record(resolveCategorySet(override));
  return usage;
}
