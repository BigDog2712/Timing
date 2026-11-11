/**
 * Timing — 活动名 → 事项名 的**建议**（P1-06，FUSION-ARCH-P1-v1 §4）
 * -----------------------------------------------------------------------------
 * 纯函数：无 DOM、无 IPC、无 i18n、无 React。唯一消费方是历史页弹卡
 * （`HistoryActivityActionDialog.tsx`），所以落在本目录（同 `timingLaneSegments.ts` 的先例）。
 *
 * ## 判定 vs 建议，两件事分开
 *
 * 宿主侧 `services/hostIntentBridge.findItemByName` 做的是**判定**：按名精确找、没有就建。
 * 这里做的是**建议**：在一堆事项里挑「最该复用的那一个」，结果只用于把弹卡文案说清楚、
 * 并把解析出来的名字递给宿主。真正的判定仍然只有宿主那一处——所以本文件找不到事项时
 * 绝不自己建，只回 `null`。
 *
 * ## 🔴 为什么不用编辑距离（Levenshtein / 拼音 / 跨语言词典）
 *
 * 中文里 2 个字的差别往往是**完全不同的事**：「写方案」vs「写代码」编辑距离 2、相似度
 * 0.67，任何 0.6 一档的阈值都会把它们判成同一件事。编辑距离在拉丁词上工作、在汉字上撒谎。
 * 所以整条算法**不引入距离度量**，只用「归一等」+「短串整段包含」两种可解释的关系。
 *
 * `Chrome` vs `Google Chrome`（6/12 = 0.5 < 0.6）**故意不匹配**：同名跨语言的正确做法是
 * 改个名，不是猜。宁可少建议一次，不可建议错。
 */

export interface ItemNameCandidate {
  id: number;
  name: string;
}

export type ItemNameMatchKind = "exact" | "contained";

export interface ItemNameSuggestion {
  kind: ItemNameMatchKind;
  score: number;
  item: ItemNameCandidate;
}

/** `contained` 的比值下限（含等于）：3/5 = 0.6 恰好达标是**有意**的边界，别写成 `>`。 */
const CONTAINED_MIN_RATIO = 0.6;
/** 短串下限：低于 3 的短串会「会」匹配进「会议纪要」，一律不参与。 */
const CONTAINED_MIN_LENGTH = 3;

/**
 * 归一化（顺序不可换，§4.2）。导出只为测试——生产代码只经 `suggestItemName` 用它。
 *
 * 1. `NFKC`：一次搞定全角（`ＶＳ` + 全角空格 + `ＣＯＤＥ` → `VS CODE`、`（重构）` → `(重构)`、`２５` → `25`）。
 *    **不要**手写 `0xFEE0` 映射表——手写的那套在中文标点上必漏。
 * 2. 小写。
 * 3. 只留字母 / 数字 / 汉字，其余（空格、标点、连字符、下划线、括号、点、斜杠）全删。
 *    ⚠️ 必须是 `\p{L}\p{N}`：汉字属于 `\p{L}`，换成 `[a-z0-9]` 会把中文全删空。
 *
 * 归一化后可能是空串（`"  "` / `"（）"`）：**空串表示「不参与匹配」**，由
 * `suggestItemName` 翻成 `null`（本函数签名是 `string`，§4.1 已锁定）。
 */
export function normalizeItemName(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 一对归一化名字的相似度：`1` = 全等，`0.6~<1` = 短串整段包含，`null` = 不参与匹配。
 *
 * `short` 一律取**较短的那一个**：`short ∈ long` 只允许单向包含。反向（`long ∈ short`）
 * 对 `Chrome` / `Google Chrome` 这种组合只会多出误配，而对称写法读起来还看不出区别。
 */
function similarity(a: string, b: string): number | null {
  if (a === b) return 1;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < CONTAINED_MIN_LENGTH) return null;
  if (!long.includes(short)) return null;
  const ratio = short.length / long.length;
  return ratio >= CONTAINED_MIN_RATIO ? ratio : null;
}

/**
 * 给一段活动的名字，在已有事项里找「最该复用的那一个」。找不到 → `null`。
 *
 * 多命中取 `score` 最高；同分取 `name` 字典序最小（确定性：同样的库换个顺序读出来，
 * 建议不许变——这是能钉测试的前提）。
 */
export function suggestItemName(
  activityName: string,
  items: readonly ItemNameCandidate[],
): ItemNameSuggestion | null {
  const target = normalizeItemName(activityName);
  if (!target) return null;

  let best: ItemNameSuggestion | null = null;
  for (const item of items) {
    const other = normalizeItemName(item.name);
    if (!other) continue;
    const score = similarity(target, other);
    if (score === null) continue;
    const kind: ItemNameMatchKind = score === 1 ? "exact" : "contained";
    /* 同分取字典序最小：`exact`（1.0）永远压过任何 `contained`（<1），无需额外分支。 */
    const wins = best === null
      || score > best.score
      || (score === best.score && item.name < best.item.name);
    if (wins) best = { kind, score, item };
  }
  return best;
}
