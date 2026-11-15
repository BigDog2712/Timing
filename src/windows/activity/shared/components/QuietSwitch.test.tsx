(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import QuietSwitch from "./QuietSwitch.tsx";

/**
 * 开关的**开启态可辨识性**判据（[本轮]）。
 *
 * 用户口径是「看不出开没开」——那不是审美问题：旧实现里开启态轨道走
 * `--at-border-strong`，thumb 用 `--at-text-tertiary` 混色，跟关闭态几乎同一个灰阶，
 * 于是"开/关"在视觉上退化成同一张图。修法是把开启态换成主色轨道 + 反向 thumb。
 *
 * 这里锁两件事，缺一条都会在下一轮被悄悄改回去（样式改动是全仓最容易"顺手还原"的）：
 *   ① **结构**：勾选时 `at-switch-checked` / `at-switch-thumb-checked` 真的挂上了，
 *      `aria-checked` 跟着变（否则样式修好了、状态却没传下来）；
 *   ② **样式**：开启态那两条规则引用的是 `--at-accent-default`，且不再出现灰色变量；
 *      尺寸（44×24 / thumb 14 / 6 ↔ 24）与 `disabled` 的 0.52 一个字没动 ——
 *      那三组数字被多处的视觉对齐验收钉着，改样式不许连带改它们。
 *
 * `?raw` 读不了 CSS（Vite 对 `.css?raw` 也走 CSS 管线），样式判据用 `readFileSync`。
 */
function readCss(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function cssBlock(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `样式里找不到 ${selector}`).toBeGreaterThan(-1);
  const brace = css.indexOf("{", at);
  const end = css.indexOf("}", brace);
  return css.slice(at, end + 1);
}

/** 冒号后的声明值（去掉分号），用于"这条规则到底引了哪个变量"这类判定 */
function decl(block: string, property: string): string {
  const match = new RegExp(`(?:^|[\\s{])${property}: ([^;]+);`).exec(block);
  return (match?.[1] ?? "").trim();
}

/**
 * 把**所有**选择器列表里含 `selector` 的规则块拼起来。
 *
 * 判据只看行为、不看写法：开启态 thumb 可以被写成 `.at-switch-checked .at-switch-thumb`
 * 与 `.at-switch-thumb-checked` 两条规则，也可以合并成一条 —— 那是实现自由度，
 * 断言"必须合并"只会在将来拆规则时变成假红。
 */
function blocksWithSelector(css: string, selector: string): string {
  const rules = css.match(/[^{}]+\{[^}]*\}/g) ?? [];
  const matched = rules.filter((rule) => rule.slice(0, rule.indexOf("{")).includes(selector));
  expect(matched.length, `样式里找不到任何含 ${selector} 的规则`).toBeGreaterThan(0);
  return matched.join("\n");
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(checked: boolean, disabled = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(QuietSwitch, {
      checked,
      disabled,
      ariaLabel: "测试开关",
      onChange: () => {},
    }));
  });
  return container.querySelector<HTMLButtonElement>(".at-switch") as HTMLButtonElement;
}

beforeEach(() => {
  container = null;
  root = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("QuietSwitch · 结构", () => {
  it("qs01_checked_mounts_the_checked_classes_and_sets_aria_checked", async () => {
    const button = await mount(true);
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(button.className.split(" ")).toContain("at-switch-checked");
    expect(button.querySelector(".at-switch-thumb")?.className.split(" "))
      .toContain("at-switch-thumb-checked");
  });

  it("qs02_unchecked_mounts_no_checked_class", async () => {
    const button = await mount(false);
    expect(button.getAttribute("aria-checked")).toBe("false");
    expect(button.className).not.toContain("at-switch-checked");
    expect(button.querySelector(".at-switch-thumb")?.className ?? "")
      .not.toContain("at-switch-thumb-checked");
  });
});

describe("QuietSwitch · 开启态样式", () => {
  const css = readCss("../../shell/styles/quiet-pro.css");

  it("qs03_the_checked_track_uses_the_accent_token_not_a_grey_one", () => {
    const track = cssBlock(css, ".at-switch-checked::before");
    expect(decl(track, "border-color"), "开启态轨道描边必须走主色（灰阶的旧值就是这次要修的病）")
      .toContain("var(--at-accent-default)");
    expect(decl(track, "background"), "开启态轨道底色必须含主色")
      .toContain("var(--at-accent-default)");
    /* 改回这两个灰阶变量 = 开启态又变得跟关闭态一个样 */
    expect(track).not.toContain("--at-border-strong");
    expect(track).not.toContain("--at-text-tertiary");
  });

  it("qs04_the_checked_thumb_contrasts_with_the_accent_track", () => {
    /* 判**行为**而不是判写法：把含 `.at-switch-thumb-checked` 的所有规则合起来看
       （合并成一条、还是拆成两条，都算通过）。 */
    const thumb = blocksWithSelector(css, ".at-switch-thumb-checked");
    expect(decl(thumb, "border-color")).toContain("var(--at-accent-default)");
    expect(decl(thumb, "background"), "开启态 thumb 必须与主色轨道反向（bg-elevated 在深浅两套主题都在对面那一端）")
      .toContain("var(--at-bg-elevated)");
    expect(thumb, "开启态 thumb 要有投影，与轨道的边分开").toContain("box-shadow");
    expect(thumb).not.toContain("--at-text-tertiary");
  });

  it("qs05_the_geometry_and_the_motion_tokens_are_untouched", () => {
    /* 三组数字被多处的视觉对齐验收钉着（44×24 的轨道、14 的 thumb、6 ↔ 24 的位移），
       改配色不许连带改它们；过渡必须继续引用 motion 令牌，不许写死毫秒。 */
    const base = cssBlock(css, ".at-switch");
    expect(decl(base, "width")).toBe("44px");
    expect(decl(base, "height")).toBe("24px");
    const track = cssBlock(css, ".at-switch::before");
    expect(track).toContain("var(--at-motion-fast)");
    expect(track).toContain("var(--at-motion-ease)");
    const thumbBase = cssBlock(css, ".at-switch-thumb");
    expect(decl(thumbBase, "width")).toBe("14px");
    expect(decl(thumbBase, "height")).toBe("14px");
    expect(decl(thumbBase, "transform")).toBe("translateX(6px)");
    expect(cssBlock(css, ".at-switch-thumb-checked")).toContain("translateX(24px)");  });

  it("qs06_disabled_still_dims_to_052", () => {
    expect(cssBlock(css, ".at-switch:disabled")).toContain("opacity: 0.52");
  });
});
