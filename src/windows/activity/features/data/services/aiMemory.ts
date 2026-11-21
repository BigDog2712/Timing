/**
 * AI 打标 · 记忆检索（分析窗侧，0.12.8）
 * =============================================================================
 * 「AI 效果不好」的根因不是模型不行，是**它看不见用户自己怎么打的**。这一层负责
 * 从库里已有的标签反推几条 few-shot 例子，随请求发给后端拼进提示词。
 *
 * ## 为什么在本地检索，而不是把全部历史塞进去
 *
 * 一个用了半年的库有几百条事项；全塞进提示词是几千 token，且大部分与本次无关。
 * 模型真正需要的是「**像这条**的历史条目当初被定成了什么」。所以按字符 bigram
 * 的 Jaccard 相似度排序，只取前 12 条（后端 `MAX_EXAMPLES` 同值）。
 *
 * ## 为什么不上 embedding
 *
 * 中文事项名大多 2-8 个字（"写周报" / "行测刷题" / "看剧"），bigram 已经把
 * "周报/月报"这类共享后缀抓得足够准。embedding 要么本地跑模型，要么每次调 API ——
 * 前者加几十 MB 依赖，后者把"省钱"这件事又还回去了。等数据量真的到几千条再说。
 *
 * ## 纯函数
 *
 * 不读库、不碰 React：输入是「事项名 + 标签」，输出是例子数组。这样能在 vitest 里
 * 直接断言排序与阈值，不用起 jsdom。
 */
import type { AiTagExample } from "../../../shared/types/ai.ts";

/** 一条可用来当例子的历史记录。 */
export interface MemoryEntry {
  text: string;
  tags: string[];
}

/** 与后端 `MAX_EXAMPLES` 对齐：再多也不会被发出去，白排序。 */
export const MAX_EXAMPLES = 12;

/** 低于这个相似度就当"无关"：宁可没有例子，也不要拿不相关的历史误导模型。 */
const MIN_SCORE = 0.18;

/** 只留文字与数字，去掉空白/标点/emoji —— "写周报" 与 "写 周报。" 应算同一个。 */
function normalizeForMatch(text: string): string {
  return text.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(text: string): string[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  /* 单字也要留一个特征：否则"剧"这种一个字的条目永远匹配不上。 */
  if (chars.length === 1) return chars;
  const out: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    out.push(chars[index] + chars[index + 1]);
  }
  return out;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const setA = new Set(left);
  const setB = new Set(right);
  let hit = 0;
  for (const gram of setA) if (setB.has(gram)) hit += 1;
  return hit / Math.max(setA.size, setB.size);
}

/**
 * 两个文本的相似度，0..1 = 0.55 × bigram + 0.45 × 单字。
 *
 * 为什么不能只用 bigram：中文短串里改一个字就换掉两个 bigram ——
 * "写月报" 与 "写周报" 的 bigram 交集是 **0**，而这恰恰是最该命中的一对。
 * 掺入单字特征后它们共享 {写, 报}，能过阈值；"行测刷题" 与 "看剧" 仍然为 0。
 * 权重偏向 bigram：单字太容易撞（"学习" 与 "学车" 共享"学"），不能当主判据。
 */
export function textSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  const bigramScore = jaccard(bigrams(a), bigrams(b));
  const unigramScore = jaccard([...a], [...b]);
  return 0.55 * bigramScore + 0.45 * unigramScore;
}

function entryKey(entry: MemoryEntry): string {
  return `${entry.text}\u0000${entry.tags.join("\u0001")}`;
}

/**
 * 从历史里挑最多 `limit` 条与本次目标最像的例子。
 *
 * 排序：相似度降序，同分保持输入顺序（调用方按"最近用过"排进来，同分时它更可信）。
 * 过滤：低于 `MIN_SCORE` 一律不要 —— "拿不准就不给"这条纪律对记忆同样适用。
 */
export function pickExamples(
  targetTexts: readonly string[],
  entries: readonly MemoryEntry[],
  limit: number = MAX_EXAMPLES,
): AiTagExample[] {
  const targets = targetTexts.map((text) => text.trim()).filter((text) => text.length > 0);
  if (targets.length === 0 || entries.length === 0 || limit <= 0) return [];
  const scored = entries.map((entry, index) => ({
    entry,
    index,
    score: targets.reduce(
      (best, target) => Math.max(best, textSimilarity(target, entry.text)),
      0,
    ),
  }));
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  const picked: AiTagExample[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (picked.length >= limit) break;
    if (row.score < MIN_SCORE) break;
    const key = entryKey(row.entry);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ text: row.entry.text, tags: [...row.entry.tags] });
  }
  return picked;
}

/**
 * 事项侧的历史条目：有标签、非系统、且**不在本次待判集合里**。
 *
 * 为什么要排除 target 自己：批量入口会把同一条既当 target 又当例子（它本来就有
 * existing，重复一遍纯浪费 token）；单条入口的 `id` 是 `"current"`，不会命中排除集，
 * 所以这里按「名字不属于待判文本」也能挡一层。
 */
export function itemMemoryEntries(
  items: readonly { id: number; name: string; isSystem?: boolean }[],
  tagsByItem: ReadonlyMap<number, readonly string[]>,
  excludeIds: ReadonlySet<string> = new Set(),
): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const item of items) {
    if (item.isSystem) continue;
    if (excludeIds.has(String(item.id))) continue;
    const tags = tagsByItem.get(item.id) ?? [];
    if (tags.length === 0) continue;
    out.push({ text: item.name, tags: [...tags] });
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 * 本地短路（0.12.9）
 *
 * 前两个函数都还是「给模型更多信息」；这一节反过来，**不问模型**。
 *
 * ## 为什么值得短路
 *
 * 用户的时间线里重复度极高：「写周报」每周一次、同一批 exe 天天在用。这些都已经
 * 有确定的答案（上次就是这么打的），再问一遍模型只会更慢、更贵、还可能换一个
 * 近义词。短路把它们留在本地，模型只处理真正没见过的对象。
 *
 * ## 阈值为什么这么高
 *
 * 错的代价不对称：**漏判**只是退回模型（多一次调用），**错判**是把错标签写进库、
 * 用户还得手动改回来。所以宁可漏。0.55 这个数来自 `diceSimilarity` 的实测口径
 * （见 `aiMemory.test.ts`）：「健身 → 健身打卡」0.58 能过，「读日记 → 读书笔记」
 * 0.26 不能过。
 *
 * ## 为什么还要看「领先幅度」
 *
 * 库里有分歧时不能替用户选：同一个名字曾被标过两种标签（用户改过口径），
 * 或者两条同样像的历史给了不同答案。此时最高分再高也不等于确定，
 * 差不到 `margin` 就交回模型。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 相似度达到这个值才敢直接采纳。调低会开始把「读日记」类推到「读书笔记」上。 */
export const LOCAL_HIT_SCORE = 0.55;
/** 最高分必须比「另一个答案」高出这么多；同答案的多条历史不算分歧。 */
export const LOCAL_HIT_MARGIN = 0.12;

/** 与单条入口 `MAX_TAGS` 一致：带出的标签不能比手填的上限还多。 */
const LOCAL_MAX_TAGS = 8;

export interface LocalHint {
  /** 命中的目标 id（原样回传，调用方用它挂回行） */
  id: string;
  tags: string[];
  /** `exact` = 同名历史；`similar` = 相似历史命中 */
  source: "exact" | "similar";
  score: number;
  /** 命中的那条历史文本，用来在 UI 上说清「因为 X 是 Y」 */
  reference: string;
}

export interface LocalResolveOptions {
  minScore?: number;
  minMargin?: number;
  maxTags?: number;
}

/** 标签集合的指纹：只用来判断「两个答案是不是同一个」，与字面顺序无关。 */
function tagKey(tags: readonly string[]): string {
  return [...tags].map((tag) => normalizeForMatch(tag)).sort().join("\u0001");
}

function dice(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let hit = 0;
  for (const gram of a) if (b.has(gram)) hit += 1;
  return (2 * hit) / (a.size + b.size);
}

/**
 * Dice 系数版相似度，**专供短路决策**，不要拿去换掉 `textSimilarity`。
 *
 * 两把尺子的区别只在聚合方式：Jaccard 除以两侧较大者，Dice 除以两者之和。
 * 挑例子时用宽的那把（宁可多给几条让模型自己判断）；短路要直接把标签写进库，
 * 必须准，但**不能因为长度的差就漏掉包含关系**：
 *
 *   | 一对 | Jaccard | Dice |
 *   |---|---|---|
 *   | 健身 / 健身打卡 | 0.41 | 0.58 ✓ |
 *   | 行测刷题 / 行测刷题第3套 | 0.53 | 0.69 ✓ |
 *   | 读日记 / 读书笔记 | 0.23 | 0.26 ✗ |
 *   | 看剧 / 看电影 | 0.15 | 0.18 ✗ |
 *
 * 短串被长串完整包含，本身就说明是同一件事；Jaccard 在这里漏判，代价是白调一次模型。
 */
export function diceSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  return 0.55 * dice(bigrams(a), bigrams(b)) + 0.45 * dice([...a], [...b]);
}

/**
 * 试着用本地记忆直接给出答案。
 *
 * 返回 `hints`（可直接采纳）与 `pending`（必须问模型）。**两者互斥且合起来等于输入**，
 * 调用方只把 `pending` 发出去就行。
 *
 * `text` 由调用方决定给什么：应用侧给纯名字（`VS Code`），不要把「名字 / exe」整串
 * 拿去比 —— exe 后缀会把相似度整体压低，让本来该命中的条目落选。
 */
export function resolveLocally(
  targets: readonly { id: string; text: string; existing: readonly string[] }[],
  entries: readonly MemoryEntry[],
  options: LocalResolveOptions = {},
): { hints: LocalHint[]; pending: string[] } {
  const minScore = options.minScore ?? LOCAL_HIT_SCORE;
  const minMargin = options.minMargin ?? LOCAL_HIT_MARGIN;
  const maxTags = options.maxTags ?? LOCAL_MAX_TAGS;
  const hints: LocalHint[] = [];
  const pending: string[] = [];
  for (const target of targets) {
    /* 已有标签的一律不短路：「重新判断」正是用户点这个按钮的语义。替他固定住旧值，
       等于让 AI 永远改不掉一个错标签 —— 那是比"慢一点"严重得多的回归。 */
    if (target.existing.length > 0) {
      pending.push(target.id);
      continue;
    }
    const text = target.text.trim();
    if (!text || entries.length === 0) {
      pending.push(target.id);
      continue;
    }
    const scored = entries
      .map((entry, index) => ({ entry, index, score: diceSimilarity(text, entry.text) }))
      .filter((row) => row.entry.tags.length > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = scored[0];
    if (!best || best.score < minScore) {
      pending.push(target.id);
      continue;
    }
    /* 次优的「不同答案」：同一标签的多条历史（用户反复用它）不构成分歧，
       反而是更强的证据。只有给出**别的答案**的历史才算竞争。 */
    const bestKey = tagKey(best.entry.tags);
    const rival = scored.find((row) => tagKey(row.entry.tags) !== bestKey);
    if (best.score - (rival?.score ?? 0) < minMargin) {
      pending.push(target.id);
      continue;
    }
    hints.push({
      id: target.id,
      tags: [...new Set(best.entry.tags)].slice(0, maxTags),
      source: best.score >= 0.999 ? "exact" : "similar",
      score: best.score,
      reference: best.entry.text,
    });
  }
  return { hints, pending };
}
