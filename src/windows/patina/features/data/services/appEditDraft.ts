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
 * 本弹窗保存后要不要镜像给宿主 `item_app`（返回 `null` = **不发**）。
 *
 * ## 为什么不能直接发 `next?.itemBindings ?? []`（P0-2）
 *
 * `buildQuickAppOverride` 在 `itemBindings` 为空时**不产出该字段**（见那里的
 * `if (resolvedBindings.length > 0)`）。于是"字段缺失"有两种完全不同的含义：
 *
 *   · 用户在这个弹窗里把勾选全取消了 → 应该发空全集（清掉宿主那一侧）；
 *   · 这个应用**本来就只在应用排行卡上绑过 1:1**（那份写在 `__app_item_binding::<exe>`，
 *     本弹窗的草稿看不到它）→ 发空全集会把宿主 `item_app` 里那条绑定**删掉**，
 *     而界面还显示"已绑定"，用户下次开游戏又不计时了（静默）。
 *
 * 两者的区分点只有一个：**保存前**这一份 override 里本来有没有 `itemBindings`。
 * 有 → 这次确实由本弹窗清空，发空全集；没有 → 本弹窗从未持有全集，不发。
 * 空数组也是显式删除信号（`buildQuickAppOverride` 只在有内容时产出字段，所以
 * 走到这里还能拿到空数组的只有"调用方显式给了空全集"这一种，按删除处理）。
 */
export function resolveItemBindingsMirrorPayload(
  current: AppOverride | null | undefined,
  next: AppOverride | null | undefined,
): { itemIds: number[]; track: number } | null {
  const before = current?.itemBindings;
  const after = next?.itemBindings;
  const heldFullSet = after !== undefined || (before?.length ?? 0) > 0;
  if (!heldFullSet) return null;
  return {
    itemIds: normalizeItemBindings(after).map((binding) => binding.itemId),
    /* `track === false` = 应用被标成「不计入」：镜像成「仅观察」，别把用户的意图覆盖成接管 */
    track: next?.track === false ? 0 : 1,
  };
}

/**
 * 把 **1:1 那份绑定**（`__app_item_binding::<exe>`，app_item_binding.ts 写的）并进草稿。
 *
 * ## 为什么要并（P0-3）
 *
 * 应用 → 事项的绑定有两份配置：本弹窗的多事项 `__app_override::<exe>.itemBindings[]`，
 * 和排行卡「绑定事项」的 1:1 `__app_item_binding::<exe>`。后者**不在本弹窗的草稿里**，
 * 所以用户在这个弹窗里根本看不到它，也就无法取消它 —— 而取消的语义一旦表达不出来，
 * 结果就是「用户明明解绑了，重启后又被启动补镜像补回来」。
 *
 * `single` 为 `null`/非法 → 原样返回（没有 1:1 绑定）。`undefined` = 读失败，
 * 同样原样返回：把"读不到"当成"没有"会让下一次保存删掉它。
 */
export function withSingleItemBinding(
  draft: AppEditDraft,
  single: number | null | undefined,
): AppEditDraft {
  if (typeof single !== 'number' || !Number.isSafeInteger(single) || single <= 0) return draft;
  if (draft.itemBindings.some((binding) => binding.itemId === single)) return draft;
  return { categories: draft.categories, itemBindings: [...draft.itemBindings, { itemId: single }] };
}

/**
 * `current` 的**真全集**版本：override 的 `itemBindings[]` ∪ 1:1 那份。
 *
 * 镜像判据（`resolveItemBindingsMirrorPayload`）必须喂这个版本 —— 它靠"保存前有没有
 * `itemBindings`"区分「用户清空了」与「我们本来就不持有这份数据」，而 1:1 那份恰恰是
 * "持有但不在 override 里"的那一半。
 */
export function withFullItemBindingSet(
  current: AppOverride | null | undefined,
  single: number | null | undefined,
): AppOverride | null {
  const base = current ?? null;
  if (typeof single !== 'number' || !Number.isSafeInteger(single) || single <= 0) return base;
  const bindings = normalizeItemBindings(base?.itemBindings);
  if (bindings.some((binding) => binding.itemId === single)) return base;
  /* 只补 `itemBindings` 这一维：其它字段（分类 / 别名 / track）保持 override 原值，
     否则"打开弹窗"就等于替用户改了别的维度 */
  return { ...(base ?? {}), itemBindings: [...bindings, { itemId: single }] };
}

/**
 * 保存后要清掉的 1:1 键（`null` = 不动）。
 *
 * 判定必须精确：只有 `__app_item_binding::<exe>` 指向的那个 `itemId` **不在**保存后的
 * 全集里时才清。它若指的是全集里还留着的另一个事项，清掉就是删了用户没取消的绑定。
 *
 * 为什么清 KV 是必须的：启动补镜像的数据源就是这份 KV（只增不减），KV 里留着，
 * 下次开机就会把 `item_app` 那行**原样补回来** —— 用户会觉得开关坏了。
 */
export function resolveSingleBindingClear(
  single: number | null | undefined,
  next: AppOverride | null | undefined,
): number | null {
  if (typeof single !== 'number' || !Number.isSafeInteger(single) || single <= 0) return null;
  const kept = normalizeItemBindings(next?.itemBindings).some((binding) => binding.itemId === single);
  return kept ? null : single;
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
