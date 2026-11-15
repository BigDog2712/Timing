/**
 * 分类目录 —— 两窗共用的**唯一**合并 / 排序 / 标签实现（[0.14]）。
 * -----------------------------------------------------------------------------
 * `list_category_catalog`（宿主命令）是哑管道：只透传活动库 settings KV 的六组
 * 原始行。合并、排序、标签解析全部收敛在本文件 —— 分析窗（patina）与药丸窗
 * （timing）各自注入标签回调，但候选集合与顺序只有这一份实现，谁都不许自带。
 *
 * ## 候选 = 应用侧四路并集 − 已删 − other
 *
 *   1. 内置键（`BUILTIN_CATEGORY_KEYS` 固定序，恒在）；
 *   2. `__custom_category::` 定义行（自定义分类的定义）；
 *   3. `__app_override::` 各行的**主分类** `category`（拍板：不读 `categories[]` 全集，
 *      与应用侧现状一致）；
 *   4. `__web_domain_override::` 同上；
 *   5. `__category_color_override::` 的键（改过颜色的分类也是真实使用过的分类）。
 *
 * `other` 永不进候选：它是"未分类"的落库值（`null`），由控件作为哨兵项补在最前。
 * `system` 同理（界面见不到）。`__deleted_category::` 里的键整组剔除。
 *
 * ## 排序（唯一实现点，消费方不得自带）
 *
 * 内置键按 `BUILTIN_CATEGORY_KEYS` 固定序在前；自定义键按显示名
 * `localeCompare(…, "zh-CN")` 在后 —— 用户新建的那条不会因为 id 是 uuid 而随机插进中间。
 */

/** settings KV 的一行（与 Rust `models/category_catalog.rs` 逐字对齐） */
export interface CategorySettingRow {
  key: string;
  value: string;
}

/** `list_category_catalog` 出参（六组原始行；手机端桩回全空数组） */
export interface CategoryCatalogRows {
  definitions: CategorySettingRow[];
  deleted: CategorySettingRow[];
  labelOverrides: CategorySettingRow[];
  colorOverrides: CategorySettingRow[];
  appOverrides: CategorySettingRow[];
  webOverrides: CategorySettingRow[];
}

/** 下拉候选项（value = 分类键，label = 显示名） */
export interface CategoryCatalogOption {
  value: string;
  label: string;
}

/** 内置可分配分类的固定序。`other` / `system` 刻意不在内（见头注释）。 */
export const BUILTIN_CATEGORY_KEYS = [
  "ai",
  "development",
  "office",
  "browser",
  "communication",
  "video",
  "music",
  "game",
  "design",
  "utility",
] as const;

/**
 * 内置分类的 zh 显示名（药丸窗 zh-only 注入用）。
 * parity 判据（`patina/.../categoryCatalogParity.test.ts`）把它与 patina
 * `uiText.categories` 的十键逐字对齐 —— 一侧改词另一侧必红。
 */
export const BUILTIN_CATEGORY_LABELS_ZH: Readonly<Record<string, string>> = {
  ai: "AI",
  development: "开发",
  office: "办公",
  browser: "浏览",
  communication: "通讯",
  video: "视频",
  music: "音乐",
  game: "游戏",
  design: "设计",
  utility: "工具",
};

/** "未分类"的落库值是 `null`；控件用空串当哨兵，出口翻回 `null`。 */
export const CATEGORY_OTHER = "other";
const CATEGORY_SYSTEM = "system";
const EXTENDED_CATEGORY_PREFIX = "custom:";

/** 与 Rust `category_catalog_cmd.rs::CATALOG_PREFIXES` 同源：加前缀两处同批改。 */
export const CATALOG_PREFIXES = {
  definitions: "__custom_category::",
  deleted: "__deleted_category::",
  labelOverrides: "__category_label_override::",
  colorOverrides: "__category_color_override::",
  appOverrides: "__app_override::",
  webOverrides: "__web_domain_override::",
} as const;

/** 剥前缀取键（只收真正带这个前缀的行，其余行静默忽略 —— KV 里的脏行不进候选）。 */
function stripPrefix(rows: readonly CategorySettingRow[], prefix: string): Array<[string, string]> {
  return rows
    .filter((row) => row.key.startsWith(prefix))
    .map((row) => [row.key.slice(prefix.length), row.value] as [string, string]);
}

function parseOverrideCategory(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const category = (parsed as { category?: unknown }).category;
    if (typeof category !== "string") return null;
    const trimmed = category.trim();
    return trimmed && trimmed !== CATEGORY_OTHER && trimmed !== CATEGORY_SYSTEM ? trimmed : null;
  } catch {
    return null;
  }
}

export interface BuildCategoryCatalogArgs {
  catalog: CategoryCatalogRows;
  /** 内置键 → 显示名（patina 注入 getCategoryToken+uiText；药丸注入 zh 表）；不认识返回 null */
  builtinLabel: (key: string) => string | null;
  /** 自定义键 → 显示名（patina 注入 resolveExtendedCategoryLabel；药丸注入解码 + 兜底名）；不认识返回 null */
  customLabel: (key: string) => string | null;
}

/** 把六组原始行合并成候选清单（见头注释：并集、过滤、排序、标签的唯一实现）。 */
export function buildCategoryCatalog(args: BuildCategoryCatalogArgs): CategoryCatalogOption[] {
  const { catalog, builtinLabel, customLabel } = args;
  const deleted = new Set(stripPrefix(catalog.deleted, CATALOG_PREFIXES.deleted).map(([key]) => key));
  const labelOverrides = new Map(
    stripPrefix(catalog.labelOverrides, CATALOG_PREFIXES.labelOverrides).map(([key, value]) => [
      key,
      value.trim() || null,
    ]),
  );

  const candidates = new Set<string>(BUILTIN_CATEGORY_KEYS);
  for (const [id] of stripPrefix(catalog.definitions, CATALOG_PREFIXES.definitions)) {
    if (id.startsWith(EXTENDED_CATEGORY_PREFIX) && id.length > EXTENDED_CATEGORY_PREFIX.length) {
      candidates.add(id);
    }
  }
  for (const [, value] of stripPrefix(catalog.appOverrides, CATALOG_PREFIXES.appOverrides)) {
    const category = parseOverrideCategory(value);
    if (category) candidates.add(category);
  }
  for (const [, value] of stripPrefix(catalog.webOverrides, CATALOG_PREFIXES.webOverrides)) {
    const category = parseOverrideCategory(value);
    if (category) candidates.add(category);
  }
  for (const [id] of stripPrefix(catalog.colorOverrides, CATALOG_PREFIXES.colorOverrides)) {
    if (id && id !== CATEGORY_OTHER && id !== CATEGORY_SYSTEM) candidates.add(id);
  }

  const labelOf = (id: string): string =>
    labelOverrides.get(id) || builtinLabel(id) || customLabel(id) || id;
  const builtinSet = new Set<string>(BUILTIN_CATEGORY_KEYS);
  const live = [...candidates].filter((id) => id !== CATEGORY_OTHER && !deleted.has(id));
  const builtinPart = BUILTIN_CATEGORY_KEYS.filter((id) => live.includes(id)).map((id) => ({
    value: id,
    label: labelOf(id),
  }));
  const customPart = live
    .filter((id) => !builtinSet.has(id))
    .map((id) => ({ value: id, label: labelOf(id) }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  return [...builtinPart, ...customPart];
}

/**
 * selectedOption 兜底：当前值非空且**不在候选**时追加 `{ value, label: 原键名 }`。
 *
 * 为什么修在消费侧而不是 QuietSelect 本体：`.qp-select-label` 默认 `visibility:hidden`、
 * 仅 `.qp-select-label-current` 可见（`quiet-select.css:43-54`），当前值不在候选时
 * 触发器整块空白；QuietSelect 有 12 个消费方，动本体等于全量回归。三分支：
 * 空值原样 / 在候选原样 / 不在候选追加。返回**新数组**（消费方直接当 options 传）。
 */
export function withCurrentValueOption(
  options: readonly CategoryCatalogOption[],
  value: string | null | undefined,
): CategoryCatalogOption[] {
  if (value == null || value === "") return [...options];
  if (options.some((option) => option.value === value)) return [...options];
  return [...options, { value, label: value }];
}
