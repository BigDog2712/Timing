/**
 * AI 打标 · 记忆检索（主窗侧，0.12.8）
 * -----------------------------------------------------------------------------
 * 与分析窗的 `features/data/services/aiMemory.ts` 是**同一套算法、两份实现**。
 * 双窗隔离（L9）不允许互相 import，所以这里只保留主窗真正用得上的那部分：
 * 事项的历史条目 + 相似度排序（药丸快捷添加与事项管理各一处）。
 *
 * 改算法时两边都要改 —— 这跟 `types/domain/ai.ts` 与 `activity/shared/types/ai.ts`
 * 各存一份是同一个代价。判据以分析窗那份的单元测试为准（它覆盖批量与单条两种场景）。
 */
import type { AiTagExample } from '../types/domain/ai';

export interface MemoryEntry {
  text: string;
  tags: string[];
}

/** 与后端 `MAX_EXAMPLES` 对齐。 */
export const MAX_EXAMPLES = 12;

const MIN_SCORE = 0.18;

function normalizeForMatch(text: string): string {
  return text.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(text: string): string[] {
  const chars = [...text];
  if (chars.length === 0) return [];
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
 * 0.55 × bigram + 0.45 × 单字。只用 bigram 时 "写月报"/"写周报" 交集为 0
 * （改一个字换掉两个 bigram），而那正是最该命中的一对；掺单字后能过阈值。
 */
export function textSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  return 0.55 * jaccard(bigrams(a), bigrams(b)) + 0.45 * jaccard([...a], [...b]);
}

/**
 * 从历史里挑最多 `limit` 条与本次目标最像的例子（相似度降序，同分保持输入顺序）。
 * 低于阈值的不要：不相关的历史比没有历史更容易把模型带偏。
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
    const key = `${row.entry.text}\u0000${row.entry.tags.join('\u0001')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ text: row.entry.text, tags: [...row.entry.tags] });
  }
  return picked;
}

/** 事项侧历史条目：有标签、非系统、且不在本次待判集合里。 */
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
 * 本地短路（0.12.9）—— 与分析窗那份同一套判据，改算法两边一起改。
 *
 * 「重复度高的对象不问模型」：「写周报」每周一次、同一批事项天天在点。它们已经有
 * 确定的答案，再问一遍只是更慢更贵，还可能换成一个近义词。
 *
 * 阈值为什么高：漏判只是退回模型，错判是把错标签写进库。所以宁可漏。
 * 为什么还看领先幅度：库里有分歧时（同名被标过两种标签）不能替用户做决定。
 * ─────────────────────────────────────────────────────────────────────────── */

export const LOCAL_HIT_SCORE = 0.55;

export const LOCAL_HIT_MARGIN = 0.12;

const LOCAL_MAX_TAGS = 8;

export interface LocalHint {
  id: string;
  tags: string[];
  source: 'exact' | 'similar';
  score: number;
  reference: string;
}

export interface LocalResolveOptions {
  minScore?: number;
  minMargin?: number;
  maxTags?: number;
}

function tagKey(tags: readonly string[]): string {
  return [...tags].map((tag) => normalizeForMatch(tag)).sort().join('\u0001');
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
 * Dice 版，专供短路决策（分析窗那份有对照表与完整理由）。
 * 关键差别：「健身」与「健身打卡」Jaccard 只有 0.41、Dice 是 0.58 —— 包含关系不该被漏掉。
 */
export function diceSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  return 0.55 * dice(bigrams(a), bigrams(b)) + 0.45 * dice([...a], [...b]);
}

/**
 * 用本地记忆直接给答案。`hints` 可采纳，`pending` 必须问模型（两者合起来等于输入）。
 * 已有标签的一律 pending —— 「重新判断」是用户点这个按钮的语义。
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
    const bestKey = tagKey(best.entry.tags);
    const rival = scored.find((row) => tagKey(row.entry.tags) !== bestKey);
    if (best.score - (rival?.score ?? 0) < minMargin) {
      pending.push(target.id);
      continue;
    }
    hints.push({
      id: target.id,
      tags: [...new Set(best.entry.tags)].slice(0, maxTags),
      source: best.score >= 0.999 ? 'exact' : 'similar',
      score: best.score,
      reference: best.entry.text,
    });
  }
  return { hints, pending };
}
