import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DataOptionTags from "./DataOptionTags.tsx";

/**
 * 应用趋势行上的标签 chip（[0.12.4] 取代「未分类」）。
 *
 * 判据钉三件事 —— 这三件事是用户看到的全部差别，也是"这页还是分类吗"的答案：
 *   ① 有标签 → **全部** `#标签` 列出来（不再只露第一个 + `+N`：侧栏窄，截断之后
 *      既认不出标签、又把应用名一起挤没了）；
 *   ② 没标签 → **空白**。这里以前写「未打标签」，占着行名右侧最值钱的宽度，
 *      而且"没标签"本来就不需要一句提示；
 *   ③ 没有 exeName（网页行）/ 匿名活动 → 什么都不画，**尤其不许**出现「未分类」。
 */
const tagsByExe: Record<string, string[]> = {};

vi.mock("../../../shared/classification/appClassification.ts", () => ({
  AppClassification: { getAppTags: (exeName: string) => tagsByExe[exeName] ?? [] },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const key of Object.keys(tagsByExe)) delete tagsByExe[key];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(exeName?: string) {
  act(() => root.render(createElement(DataOptionTags, { exeName })));
}

describe("应用趋势行的标签 chip", () => {
  it("dt01_lists_every_tag_so_nothing_is_hidden_behind_a_counter", () => {
    tagsByExe["chrome.exe"] = ["娱乐/燕云", "学习/考公", "工作"];
    mount("chrome.exe");
    const chips = Array.from(container.querySelectorAll(".data-app-option-tag")).map(
      (chip) => chip.textContent,
    );
    expect(chips).toEqual(["#娱乐/燕云", "#学习/考公", "#工作"]);
    expect(container.querySelector(".data-app-option-tags")?.getAttribute("title"))
      .toBe("#娱乐/燕云 #学习/考公 #工作");
  });

  it("dt01b_keeps_the_full_path_of_a_nested_tag", () => {
    /* `#学习/考…` 那种截断让标签失去意义：路径就是标签的身份 */
    tagsByExe["deepseek.exe"] = ["学习/考公"];
    mount("deepseek.exe");
    expect(container.textContent).toBe("#学习/考公");
  });

  it("dt02_draws_nothing_when_the_app_has_no_tag", () => {
    mount("timing.exe");
    expect(container.textContent).toBe("");
    expect(container.querySelector(".data-app-option-tags")).toBeNull();
  });

  it("dt03_renders_nothing_for_rows_without_a_tag_channel", () => {
    /* 网页行没有 exeName，匿名活动也没有标签入口：两者都该是**空白** ——
       绝不能退回「未分类」，那正是这一轮要去掉的东西 */
    mount(undefined);
    expect(container.textContent).toBe("");
    mount("activity:anonymous");
    expect(container.textContent).toBe("");
  });
});
