/**
 * AI 自动打标签 · 纯逻辑层（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 「应用」与「事项」是**两套写面**（应用走 override、事项走 `set_item_tags`），
 * 但用户在界面上看到的是同一件事：一批对象 + 每个对象该有哪些标签。所以这一层只做
 * 与写面无关的四件事，全部是纯函数，能在 jsdom 之外直接断言：
 *
 *   1. **候选表**（`buildTagCandidates`）—— 已有标签的并集，模型只能从这里挑、
 *      或按一级白名单新建。上限 200 是后端的硬拒绝（`MAX_CANDIDATES`），
 *      超了整批请求会失败，所以裁剪必须发生在这里、而不是等后端报错。
 *   2. **行合并**（`mergeSuggestions`）—— 把模型回的 `suggestions` 挂回目标行。
 *      模型可能返回没发过去的 id、或同一 id 两条，这里一律按"先到先得"丢弃。
 *   3. **勾选默认值**（`rowChips` / `defaultSelection`）—— 既有标签与建议标签
 *      并排显示，但**默认只勾建议**：这一版的口径是"AI 重新判断已有标签"，
 *      所以没被建议的旧标签默认落选（用户仍可勾回来）。
 *   4. **写入计划**（`buildApplyPlan`）—— 把勾选结果拆成"应用侧"与"事项侧"两份
 *      payload。拆分点必须只有这一处：两套写面的归一规则不同（应用 12 个上限、
 *      事项由后端归一），在这里分开比在组件里 if/else 更不容易漂。
 *
 * **不做的事**：不读库、不发请求、不碰 React。写入见 `aiAutoTagApply.ts`。
 */
import type { AiTagCandidate, AiTagSuggestion } from "../../../shared/types/ai.ts";
import { normalizeTagPath } from "../../../../shared/tags/normalize.ts";

export type AutoTagKind = "app" | "item";

/** 一个待打标签的对象。`id` 是写库用的身份（应用 = exe、事项 = 主键字符串），原样回传给模型。 */
export interface AutoTagTarget {
  kind: AutoTagKind;
  id: string;
  /** 界面上显示的名字（应用名 / 事项名） */
  name: string;
  /** 给模型看的文本：应用是「名字 / exe」，事项是名字 */
  text: string;
  /** 当前已有的标签。应用是 override.tags，事项是 items.tags */
  existing: string[];
}

export interface AutoTagRow extends AutoTagTarget {
  /** 模型建议的标签（已归一、去重、限量；可能为空 = 这一条模型拿不准） */
  suggested: string[];
}

/** 与后端 `MAX_CANDIDATES` 一致：超了整批 400，不是逐条丢弃。 */
export const MAX_CANDIDATES = 200;

/** 与 `normalizeAppTags` 的上限一致（应用侧 12 个）。事项侧由后端再归一一次。 */
export const MAX_TAGS_PER_TARGET = 12;

function canonicalKey(path: string): string {
  /* 与 `dataTagReadModel` / `normalizeAppTags` 同一套折叠：忽略大小写 + 希腊字母 sigma 变体。
     两处口径不一致时会出现"同一个标签在候选表里出现两次"（模型挑哪个都对，写进库却是两条）。 */
  return path.toLocaleLowerCase("en-US").replace(/\u03c2/gu, "\u03c3");
}

/**
 * 标签候选表：**已有标签的并集**（定义行 + 事项上的 + 应用上的）。
 *
 * 为什么不用"标签树里的一级节点"当候选：模型更擅长匹配具体路径（`学习/考公`），
 * 只给一级会让它每次都在"新建"和"选父级"之间摇摆，产出比给全量路径更散。
 *
 * 同时统计 `used`（同一路径在输入里出现几次 ≈ 有多少条对象在用它）。这是给模型的
 * 先验：`工作/周报` 用过 20 次、`工作/汇报` 用过 1 次时，前者才是用户的口径，
 * 不该被新建的近义路径顶掉。0.12.8 起 `definitions` 也各算一次 —— 它表示"这个标签
 * 在树里存在"，与"有对象在挂它"合起来才是完整的存在感。
 */
export function buildTagCandidates(paths: Iterable<string>): AiTagCandidate[] {
  const counts = new Map<string, { path: string; count: number }>();
  for (const raw of paths) {
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch {
      continue;
    }
    if (!path) continue;
    const key = canonicalKey(path);
    const row = counts.get(key);
    if (row) {
      row.count += 1;
      continue;
    }
    counts.set(key, { path, count: 1 });
  }
  /* 先按使用次数截断、再按拼音排：反过来的话，截断点会按字母序切掉一堆常用标签，
     模型的候选表里就只剩 `Z` 开头的冷门路径。顺序只影响展示，`used` 才是信号。 */
  const ranked = [...counts.values()].sort(
    (left, right) => right.count - left.count || left.path.localeCompare(right.path, "zh-CN"),
  );
  return ranked.slice(0, MAX_CANDIDATES)
    .map((row) => ({ key: row.path, label: row.path, used: row.count }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

/** 归一 + 去重 + 限量。坏路径跳过（它是"这一条脏"，不是"整批失败"）。 */
export function normalizeTagList(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch {
      continue;
    }
    if (!path) continue;
    const key = canonicalKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= MAX_TAGS_PER_TARGET) break;
  }
  return out;
}

/**
 * 把模型回的 `suggestions` 挂回目标行。
 *
 * 三种脏输入都只影响**这一条**：
 *   · id 不在本次发出去的集合里（模型抄错 / 幻觉）→ 丢弃；
 *   · 同一 id 回了两条 → 先到先得；
 *   · 建议的标签为空 → 保留这一条但 `suggested: []`，由调用方决定要不要展示
 *     （默认不展示：一行"AI 也没想法"的占位会把人埋掉）。
 *
 * `order` 跟输入顺序走，不跟模型回的顺序 —— 预览清单要稳定，重跑一次就重排的话
 * 用户刚勾好的位置会跳。
 */
export function mergeSuggestions(
  targets: readonly AutoTagTarget[],
  suggestions: readonly AiTagSuggestion[],
): AutoTagRow[] {
  const byId = new Map<string, string[]>();
  for (const suggestion of suggestions) {
    if (byId.has(suggestion.id)) continue;
    byId.set(suggestion.id, normalizeTagList(suggestion.tags));
  }
  return targets.map((target) => ({
    ...target,
    existing: normalizeTagList(target.existing),
    suggested: byId.get(target.id) ?? [],
  }));
}

export interface AutoTagChip {
  tag: string;
  /** 模型建议过它（默认勾选） */
  suggested: boolean;
  /** 这个对象身上本来就有（默认落选，但留着让用户勾回来） */
  existing: boolean;
}

/**
 * 一行里要显示的全部标签 chip：既有 ∪ 建议，按拼音序。
 *
 * 为什么要显示**既有**：这一版的口径是"AI 重新判断已有标签"，如果不把旧标签铺出来，
 * 用户看不出"哪几个要没了"；写入是全量覆盖，看不见就等于静默删除。
 */
export function rowChips(row: AutoTagRow): AutoTagChip[] {
  const suggested = new Set(row.suggested.map(canonicalKey));
  const existing = new Set(row.existing.map(canonicalKey));
  const all = new Map<string, string>();
  /* 建议在前：同一个标签两处写法只差大小写时，chip 的**字面**取建议那一份 ——
     `aria-pressed` 是拿 chip 的字面去 `selection` 里查的，两边字面不一致会出现
     "已经勾了但显示没勾"。 */
  for (const tag of [...row.suggested, ...row.existing]) {
    const key = canonicalKey(tag);
    if (!all.has(key)) all.set(key, tag);
  }
  return [...all.entries()]
    .map(([key, tag]) => ({ tag, suggested: suggested.has(key), existing: existing.has(key) }))
    .sort((left, right) => left.tag.localeCompare(right.tag, "zh-CN"));
}

/** 默认勾选 = 模型建议的那几个（"重新判断"的语义就落在这一个函数里）。 */
export function defaultSelection(row: AutoTagRow): string[] {
  return [...row.suggested];
}

/** 只展示"有建议"的行；其余计数单独报，不占列表。 */
export function visibleRows(rows: readonly AutoTagRow[]): AutoTagRow[] {
  return rows.filter((row) => row.suggested.length > 0);
}

/**
 * 勾选表的主键。
 *
 * 为什么不直接用 `id`：应用的身份是 exe、事项是数字主键，两个命名空间本来不重叠，
 * 但"不重叠"是巧合而不是约束 —— 拿 `kind:id` 复合键就不用赌这件事，也让调试时
 * 一眼看出这一条是哪个写面。
 */
export function rowKey(row: Pick<AutoTagRow, "kind" | "id">): string {
  return `${row.kind}:${row.id}`;
}

/** 模型新建的标签（两边响应合起来），写库前要补一张定义行。 */
export function collectCreatedTags(
  responses: readonly { created?: readonly string[] }[],
): string[] {
  const all = responses.flatMap((response) => response.created ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch {
      continue;
    }
    if (!path) continue;
    const key = canonicalKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export interface AutoTagPlan {
  apps: Array<{ exeName: string; tags: string[] }>;
  items: Array<{ itemId: number; tags: string[] }>;
}

/**
 * 勾选结果 → 两套写面的 payload。
 *
 * `selection` 里没有出现的行 = 用户没动它（或它本来就没有建议）→ **不写**。
 * 出现但标签为空 = 用户把这一行的 chip 全摘了 → **写空数组**（= 清空该对象标签）。
 * 这两种语义必须分开：把"没动"当成"清空"会一夜之间洗掉所有手填标签。
 */
export function buildApplyPlan(
  rows: readonly AutoTagRow[],
  selection: Readonly<Record<string, readonly string[]>>,
): AutoTagPlan {
  const plan: AutoTagPlan = { apps: [], items: [] };
  for (const row of rows) {
    const picked = selection[rowKey(row)];
    if (!picked) continue;
    const tags = normalizeTagList(picked);
    if (row.kind === "app") {
      plan.apps.push({ exeName: row.id, tags });
      continue;
    }
    const itemId = Number(row.id);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) continue;
    plan.items.push({ itemId, tags });
  }
  return plan;
}

/** 底部那句「将写入 X 个应用、Y 个事项」—— 只数**真正会发出去**的条目。 */
export function summarizePlan(plan: AutoTagPlan): { apps: number; items: number; total: number } {
  return { apps: plan.apps.length, items: plan.items.length, total: plan.apps.length + plan.items.length };
}
