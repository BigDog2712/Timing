/**
 * 「应用 → 分类」绑定的排序与重排（纯函数）。
 *
 * ## 为什么排序规则必须与 Rust 侧一字不差
 *
 * `services::insight::data::attribution::resolve_child_category` 的规则 2 取的是
 * `(priority, category_key)` 最小的那条。界面若按「插入顺序」或「只按 priority」排，
 * 同 priority 的两条在两边就可能不是同一条 —— 界面上标着「首位：社交」，
 * 实际切片出来是「娱乐」。两条规则各自都对，结果不一致，且**零报错**。
 *
 * 所以这里只提供一个 `compareAppCategory`，界面排序、重排、分组全部经过它。
 *
 * ## priority 为什么是 10 的倍数
 *
 * 重排时整组重新分配（`index * 10`），留出空隙是为了「拖到两条之间」将来不用
 * 重排整组。当前只有上移/下移两个动作，倍数只是把未来的改动面压小。
 */
import type { AppCategoryRow } from "../../../platform/persistence/attributionGateway.ts";

/** 一条绑定的排序比较器：priority 升序，同 priority 按 `categoryKey` 字典序。 */
export function compareAppCategory(left: AppCategoryRow, right: AppCategoryRow): number {
  return left.priority - right.priority || left.categoryKey.localeCompare(right.categoryKey);
}

/** 同一应用的分类：排序后的新数组（不改入参）。 */
export function sortCategories(rows: readonly AppCategoryRow[]): AppCategoryRow[] {
  return [...rows].sort(compareAppCategory);
}

/** 把一组分类按 `index * 10` 重新分配 priority（调用方保证顺序已确定）。 */
export function reassignPriorities(rows: readonly AppCategoryRow[]): AppCategoryRow[] {
  return rows.map((row, index) => ({ ...row, priority: index * 10 }));
}

/**
 * 把 `categoryKey` 上移或下移一位，返回**重排后**的整组（priority 已重算）。
 *
 * 越界、找不到该分类、或只有一个分类时返回排序后的等价副本 —— 调用方可以无条件
 * 拿返回值去写库，不必先判「能不能移」。这样按钮的禁用只是视觉提示，
 * 不存在「按钮可点但点了没反应」的第二套判据。
 */
export function moveCategory(
  rows: readonly AppCategoryRow[],
  categoryKey: string,
  direction: "up" | "down",
): AppCategoryRow[] {
  const ordered = sortCategories(rows);
  const index = ordered.findIndex((row) => row.categoryKey === categoryKey);
  if (index < 0) return ordered;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered;
  const next = [...ordered];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return reassignPriorities(next);
}

/**
 * 追加一条到**末尾**（priority = 末位 + 10）。
 *
 * 新分类默认排在最后而不是最前：用户刚加的那条还没被确认为「兜底答案」，
 * 若默认置顶，一次「加错了」就会静默改掉这个应用所有历史的分类归属。
 */
export function appendCategory(
  rows: readonly AppCategoryRow[],
  appKey: string,
  categoryKey: string,
): AppCategoryRow[] {
  const ordered = sortCategories(rows);
  const last = ordered[ordered.length - 1];
  const priority = last ? last.priority + 10 : 0;
  /* `appKey` 显式传入，不从 `last` 推：空组时 `last` 不存在，从它取会让新行
     带着空 `app_key` 落库 —— 而 `app_key` 是这张表的主键之一，空串是合法值，
     写进去既不报错也永远不会被 `list(app_key)` 查出来。 */
  return [...ordered, { appKey, categoryKey, priority }];
}

/** 按 `appKey` 分组，组内已排序；外层按 appKey 字典序（列表稳定，不随取数顺序跳）。 */
export function groupByApp(rows: readonly AppCategoryRow[]): Map<string, AppCategoryRow[]> {
  const grouped = new Map<string, AppCategoryRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.appKey);
    if (list) list.push(row);
    else grouped.set(row.appKey, [row]);
  }
  const sorted = new Map<string, AppCategoryRow[]>();
  for (const appKey of [...grouped.keys()].sort((left, right) => left.localeCompare(right))) {
    sorted.set(appKey, sortCategories(grouped.get(appKey) ?? []));
  }
  return sorted;
}
