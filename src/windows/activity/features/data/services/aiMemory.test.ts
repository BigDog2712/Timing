import { describe, expect, it } from "vitest";

import {
  MAX_EXAMPLES,
  itemMemoryEntries,
  pickExamples,
  resolveLocally,
  textSimilarity,
  type MemoryEntry,
} from "./aiMemory.ts";

/**
 * 记忆检索的判据（[0.12.8]）。
 *
 * 这一层错了**不会报错**，只会让 AI 拿到无关的历史、或者干脆拿不到历史 ——
 * 两种都是"效果不好"但看不出原因。所以钉三件事：
 *   · 相似度确实抓住了"同后缀/同前缀"（周报 vs 月报）；
 *   · 排序按相似度、不是按输入顺序（输入顺序是"最近用过"，只作同分时的次序）；
 *   · 无关条目不进例子（不相关比没有更糟）。
 */

function entry(text: string, tags: string[]): MemoryEntry {
  return { text, tags };
}

describe("文本相似度", () => {
  it("m01_同后缀的短事项能互相命中", () => {
    expect(textSimilarity("写月报", "写周报")).toBeGreaterThan(0);
    expect(textSimilarity("写月报", "写周报")).toBeLessThan(1);
  });

  it("m02_忽略空白与标点_大小写也不敏感", () => {
    expect(textSimilarity("写 周报。", "写周报")).toBe(1);
    expect(textSimilarity("Chrome", "chrome")).toBe(1);
  });

  it("m03_完全无关的文本得 0", () => {
    expect(textSimilarity("行测刷题", "看剧")).toBe(0);
    expect(textSimilarity("", "看剧")).toBe(0);
  });
});

describe("例子挑选", () => {
  it("m04_按相似度排序而不是输入顺序", () => {
    const entries = [
      entry("看剧", ["娱乐"]),
      entry("写周报", ["工作/周报"]),
      entry("写月报总结", ["工作/月报"]),
    ];
    const picked = pickExamples(["写月报"], entries);
    expect(picked[0]?.text).toBe("写月报总结");
    expect(picked.map((row) => row.text)).not.toContain("看剧");
  });

  it("m05_无关条目一条都不给", () => {
    expect(pickExamples(["行测刷题"], [entry("看剧", ["娱乐"])])).toEqual([]);
    expect(pickExamples(["行测刷题"], [])).toEqual([]);
  });

  it("m06_条数上限与后端一致", () => {
    const entries = Array.from({ length: MAX_EXAMPLES + 8 }, (_, index) =>
      entry(`写周报${index}`, [`工作/周报${index}`]),
    );
    expect(pickExamples(["写周报"], entries)).toHaveLength(MAX_EXAMPLES);
  });

  it("m07_同一条只出现一次", () => {
    const picked = pickExamples(["写周报"], [
      entry("写周报", ["工作/周报"]),
      entry("写周报", ["工作/周报"]),
    ]);
    expect(picked).toHaveLength(1);
  });

  it("m08_目标文本为空时不编造例子", () => {
    expect(pickExamples(["  "], [entry("写周报", ["工作/周报"])])).toEqual([]);
  });
});

describe("事项历史条目", () => {
  const items = [
    { id: 1, name: "未归类", isSystem: true },
    { id: 2, name: "写周报" },
    { id: 3, name: "看剧" },
    { id: 4, name: "发呆" },
  ];
  const tags = new Map<number, readonly string[]>([
    [2, ["工作/周报"]],
    [3, ["娱乐"]],
    [4, []],
  ]);

  it("m09_只收有标签的_非系统的条目", () => {
    const entries = itemMemoryEntries(items, tags);
    expect(entries.map((row) => row.text)).toEqual(["写周报", "看剧"]);
  });

  it("m10_已在本次待判集合里的条目不重复当例子", () => {
    const entries = itemMemoryEntries(items, tags, new Set(["2"]));
    expect(entries.map((row) => row.text)).toEqual(["看剧"]);
  });
});

/**
 * 本地短路的判据（[0.12.9]）。
 *
 * 这一层比 `pickExamples` 危险一个量级：它给出的答案会**直接写进库**。
 * 所以钉的重点不是"能命中多少"，而是三条刹车：
 *   · 已有标签的不许碰（否则 AI 再也改不掉一个错标签）；
 *   · 库里有分歧时不许选（同名被标过两种标签）；
 *   · 不够像的时候不许猜（错判要用户手动改，漏判只是多一次调用）。
 */
describe("本地短路", () => {
  it("r01_同名历史直接命中_标记为精确", () => {
    const { hints, pending } = resolveLocally(
      [{ id: "7", text: "写周报", existing: [] }],
      [entry("写周报", ["工作/周报"])],
    );
    expect(pending).toEqual([]);
    expect(hints).toEqual([
      { id: "7", tags: ["工作/周报"], source: "exact", score: 1, reference: "写周报" },
    ]);
  });

  it("r02_包含关系也算命中_标记为相似", () => {
    /* 「健身」被「健身打卡」完整包含：Jaccard 只有 0.41，Dice 0.58 才过得去。
       这一条是 `diceSimilarity` 存在的理由 —— 换成 Jaccard 会在这里漏判。 */
    const { hints } = resolveLocally(
      [{ id: "9", text: "健身", existing: [] }],
      [entry("健身打卡", ["生活/运动"])],
    );
    expect(hints[0]?.tags).toEqual(["生活/运动"]);
    expect(hints[0]?.source).toBe("similar");
  });

  it("r03_不够像就不猜_退回模型", () => {
    /* 「读日记」与「读书笔记」共享首字与尾字，Dice 只有 0.26 —— 凭这个写库就是瞎猜。 */
    const { hints, pending } = resolveLocally(
      [{ id: "11", text: "读日记", existing: [] }],
      [entry("读书笔记", ["学习/阅读"])],
    );
    expect(hints).toEqual([]);
    expect(pending).toEqual(["11"]);
  });

  it("r04_已有标签的一律不短路", () => {
    /* 「重新判断」是用户点这个按钮的语义；替他固定旧值，等于 AI 永远删不掉错标签。 */
    const { hints, pending } = resolveLocally(
      [{ id: "3", text: "写周报", existing: ["工作/周报"] }],
      [entry("写周报", ["工作/周报"])],
    );
    expect(hints).toEqual([]);
    expect(pending).toEqual(["3"]);
  });

  it("r05_同名却有两种标签_交回模型裁决", () => {
    const { hints, pending } = resolveLocally(
      [{ id: "5", text: "复盘", existing: [] }],
      [entry("复盘", ["复盘/周"]), entry("复盘", ["复盘/月"])],
    );
    expect(hints).toEqual([]);
    expect(pending).toEqual(["5"]);
  });

  it("r06_同标签的多条历史不算分歧", () => {
    /* 用户反复用同一个标签，是更强的证据而不是矛盾。 */
    const { hints } = resolveLocally(
      [{ id: "5", text: "复盘", existing: [] }],
      [entry("复盘", ["复盘/周"]), entry("复盘周会", ["复盘/周"])],
    );
    expect(hints[0]?.tags).toEqual(["复盘/周"]);
  });

  it("r07_命中与待判加起来正好是全部输入_不重不漏", () => {
    const targets = [
      { id: "a", text: "写周报", existing: [] },
      { id: "b", text: "读日记", existing: [] },
      { id: "c", text: "看剧", existing: ["娱乐"] },
    ];
    const { hints, pending } = resolveLocally(targets, [entry("写周报", ["工作/周报"])]);
    const all = [...hints.map((row) => row.id), ...pending].sort();
    expect(all).toEqual(["a", "b", "c"]);
  });

  it("r08_空记忆库不编造答案", () => {
    const { hints, pending } = resolveLocally([{ id: "1", text: "写周报", existing: [] }], []);
    expect(hints).toEqual([]);
    expect(pending).toEqual(["1"]);
  });

  it("r09_带出的标签去重且不超过上限", () => {
    const tags = ["工作/周报", "工作/周报", "工作", "复盘", "学习", "娱乐", "工具", "生活", "多余的"];
    const { hints } = resolveLocally(
      [{ id: "1", text: "写周报", existing: [] }],
      [{ text: "写周报", tags }],
    );
    expect(hints[0]?.tags).toHaveLength(8);
    expect(hints[0]?.tags.filter((tag) => tag === "工作/周报")).toHaveLength(1);
  });
});
