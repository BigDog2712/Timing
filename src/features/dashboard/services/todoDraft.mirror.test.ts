import { describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

import { TODO_TITLE_MAX_CHARS } from "./todoDraft.ts";

/**
 * [本轮] `TODO_TITLE_MAX_CHARS` 与宿主侧常量的**镜像判据**。
 *
 * `src/lib/constants.ts:25` 的 `TODO_TITLE_MAX_CHARS = 200` 是主窗模块，L9
 * （`scripts/check-layers.mjs`）禁止分析窗 import，所以 `todoDraft.ts` 只能镜像一份。
 * 镜像意味着"改一处忘另一处"不报错 —— 症状是静默的：弹层 `maxLength` 放行了 201 字，
 * 后端 `todo_create` 的 1-200 校验却拒了。这条测试读两侧源码比对字面量，漂一个数就红。
 *
 * 为什么读源码而不是 import：import 就直接踩 L9 了；`readFileSync` 只读文本不破门禁
 * （照 `itemPrefs.mirror.test.ts` 的先例）。
 */
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/** 从源码里抠 `export const NAME = 123;` 的数字；抠不到返回 `null`（哨兵会因此变红）。 */
function numericConst(source: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\b`).exec(source);
  return match ? Number(match[1]) : null;
}

const hostSource = read("../../../lib/constants.ts");

describe("todoDraft 与宿主侧 TODO_TITLE_MAX_CHARS 的镜像", () => {
  it("tdm01_max_chars_matches_src_lib_constants", () => {
    expect(numericConst(hostSource, "TODO_TITLE_MAX_CHARS")).toBe(TODO_TITLE_MAX_CHARS);
  });

  /* 哨兵：正则写错 / 常量改名会让上面那条“两边都抠不到 → null === null”假绿。
     这里先确认宿主源码里真的存在这个名字，且镜像侧的值是一个正数。 */
  it("tdm02_the_host_source_still_declares_that_name", () => {
    expect(hostSource).toContain("TODO_TITLE_MAX_CHARS");
    expect(TODO_TITLE_MAX_CHARS).toBeGreaterThan(0);
    expect(numericConst(hostSource, "TODO_TITLE_MAX_CHARS")).not.toBeNull();
  });
});
