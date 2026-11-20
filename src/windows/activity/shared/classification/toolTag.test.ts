import { describe, expect, it } from "vitest";

import { isToolTags, TOOL_TOP_LEVEL_TAG } from "./toolTag.ts";

/**
 * 「工具」标签判定（P0-9）。
 *
 * 这七条钉的是**边界**，不是"能跑"：工具类判定直接决定"这段时长算不算进总量/分布"，
 * 松一格就是用户的口径被悄悄改掉，所以两边（该命中的 / 不该命中的）都要有反证。
 *
 * 变异靶点：把 `path === TOOL_TOP_LEVEL_TAG` 删掉 → tool01 红；把前缀改成
 * `path.startsWith("工具")`（丢掉斜杠）→ tool07 红（`工具链` 会被误判成工具类）。
 */
describe("isToolTags", () => {
  it("tool01_bare_top_level_tag_counts_as_tool", () => {
    expect(isToolTags(["工具"])).toBe(true);
    expect(TOOL_TOP_LEVEL_TAG).toBe("工具");
  });

  it("tool02_two_level_sub_tag_counts_as_tool", () => {
    /* 二级细分（工具/下载、工具/系统）现在没有写入入口，但判定先按前缀认下来：
       将来后端开口子时，这里不用改（PRD 待确认 2 的默认口径）。 */
    expect(isToolTags(["工具/下载"])).toBe(true);
    expect(isToolTags(["工具/系统"])).toBe(true);
  });

  it("tool03_other_top_levels_do_not_count", () => {
    expect(isToolTags(["工作"])).toBe(false);
    expect(isToolTags(["生活", "学习", "娱乐", "复盘"])).toBe(false);
  });

  it("tool04_tool_as_a_child_of_another_top_level_does_not_count", () => {
    /* 「工作/工具」的**一级**是工作，不是工具类 —— 前缀判定天然把它排除。
       变异靶点：把判据改成 `path.includes("工具")` → 本条红。 */
    expect(isToolTags(["工作/工具"])).toBe(false);
    expect(isToolTags(["学习/工具用法"])).toBe(false);
  });

  it("tool05_empty_array_is_not_tool", () => {
    /* 未打标的应用是绝大多数：它们必须照常计入统计 */
    expect(isToolTags([])).toBe(false);
  });

  it("tool06_whitespace_around_the_path_is_trimmed", () => {
    expect(isToolTags([" 工具 "])).toBe(true);
    expect(isToolTags(["  工具/终端\t"])).toBe(true);
    /* 空白串不是标签 */
    expect(isToolTags(["", "   "])).toBe(false);
  });

  it("tool07_prefix_requires_the_slash", () => {
    /* `工具链` 是另一个词，不能因为开头两个字相同就被当成工具类 */
    expect(isToolTags(["工具链"])).toBe(false);
  });

  it("tool08_mixed_list_hits_on_any_tool_path", () => {
    expect(isToolTags(["学习/考公", "工具/终端"])).toBe(true);
    expect(isToolTags(["学习/考公", "娱乐/燕云"])).toBe(false);
  });
});
