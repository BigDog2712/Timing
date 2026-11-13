/**
 * [本轮 T05] 数据/设置页头删除判据：
 *   · V-4a（源码级）：`Data` / `Settings` 不再有 `QuietPageHeader` 根节点；
 *     两页都有 `h1.sr-only`（无障碍名字不丢）。
 *   · V-4b（源码级）：设置的保存/取消仍渲染，且位于 `QuietPageToolbar` 容器内；
 *     `SettingsHeaderActions` 的 `QuietButton` 是 `compact`（不是被降级成
 *     `qp-link-btn`，也必须**不是**原来的 `large` —— 容器变窄了）。
 *   · V-4c（运行时）：`SettingsGroupNav` 的高亮判定线**读自 CSS**（锚点的
 *     `scroll-margin-top`），不是第二个手抄常量 —— stub 成另一个值，高亮随之变；
 *     以及 `settings-handles.css` 里的值就是 18px（页头删除后的配套值，
 *     改回失配值 60 必红 —— 变异④）。
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from "node:path";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from "node:url";

/* 本文件在 src/windows/patina/features/settings/components/ 下：六级出去就是仓库根。
 * ⚠ 不用 `new URL(<字面量>, import.meta.url)`：vite 会把字面量形态静态重写成 dev-server
 * URL（http://），fs 一律拒绝。先 fileURLToPath 再 join 是仓里的既有写法。 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("[T05] V-4a · 两页页头删除（源码级）", () => {
  test("Settings 不再有 QuietPageHeader，且保留 h1.sr-only", () => {
    const source = read("src/windows/patina/features/settings/components/Settings.tsx");
    expect(source).not.toContain("QuietPageHeader");
    expect(source).toContain('<h1 className="sr-only">');
  });

  test("Data 不再有 QuietPageHeader，且保留 h1.sr-only", () => {
    const source = read("src/windows/patina/features/data/components/Data.tsx");
    expect(source).not.toContain("QuietPageHeader");
    expect(source).toContain('<h1 className="sr-only">');
  });
});

describe("[T05] V-4b · 保存/取消进 QuietPageToolbar（源码级）", () => {
  test("Settings 把 SettingsHeaderActions 挂进 QuietPageToolbar 容器", () => {
    const source = read("src/windows/patina/features/settings/components/Settings.tsx");
    expect(source).toMatch(/<QuietPageToolbar[^>]*>/);
    const toolbarBody = source.slice(
      source.indexOf("<QuietPageToolbar"),
      source.indexOf("</QuietPageToolbar>"),
    );
    expect(toolbarBody).toContain("<SettingsHeaderActions");
  });

  test("SettingsHeaderActions 的按钮是 compact（不是 large，也不是 link-btn）", () => {
    const source = read("src/windows/patina/features/settings/components/SettingsHeaderActions.tsx");
    expect(source).not.toMatch(/size="large"/);
    expect(source.match(/size="compact"/g)?.length).toBe(2);
    expect(source).not.toContain("qp-link-btn");
  });
});

/**
 * V-4c（运行时）：`SettingsGroupNav` 的高亮判定线读自锚点的 `scroll-margin-top`。
 * jsdom 不解析样式表 → `getComputedStyle` 打桩：桩值即"CSS 值"。判据两条：
 *  ① 判定线随桩值变化（证明不是写死的常量 —— 把 `ACTIVE_OFFSET` 改回写死 56 必红）；
 *  ② 真实的 `settings-handles.css` 里 `scroll-margin-top` 是 18px（页头删除后的配套
 *     值 —— 改回 60 的失配值必红，这就是变异④的红线）。
 */
describe("[T05] V-4c · 锚点判定线读自 CSS（运行时）", () => {
  let scrollMarginTopValue = 18;

  beforeEach(() => {
    scrollMarginTopValue = 18;
    document.body.innerHTML = "";
    // jsdom 没有 scrollIntoView；判定只关心"跳"这件事被发起
    Element.prototype.scrollIntoView = vi.fn();
    /* 组件的 scroll 监听走 rAF 节流：jsdom 的 rAF 视配置而定，这里给一个可 flush 的实现 */
    const w = window as unknown as {
      requestAnimationFrame?: (cb: (time: number) => void) => number;
      cancelAnimationFrame?: (handle: number) => void;
    };
    w.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
    w.cancelAnimationFrame = (handle) => clearTimeout(handle);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((el: HTMLElement) => ({
      scrollMarginTop: `${scrollMarginTopValue}px`,
      __el: el,
    })) as unknown as typeof window.getComputedStyle);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("settings-handles.css 的 scroll-margin-top 是 18px（变异④：改回 60 必红）", () => {
    const css = read("src/windows/patina/shell/styles/features/settings-handles.css");
    expect(css).toMatch(/scroll-margin-top:\s*18px/);
    expect(css).not.toMatch(/scroll-margin-top:\s*60px/);
  });

  test("高亮判定线随 CSS 值变化（不是写死的常量）", async () => {
    const { default: SettingsGroupNav } = await import("./SettingsGroupNav.tsx");
    const { SETTINGS_GROUPS } = await import("../settingsGroups");

    // 滚动容器 + 五组锚点：第 i 组的锚点 rect top = i * 100
    const scroll = document.createElement("div");
    scroll.id = "settings-scroll";
    document.body.appendChild(scroll);
    const rects = new Map<string, DOMRect>();
    SETTINGS_GROUPS.forEach((group: { anchors: readonly { id: string }[] }, index: number) => {
      for (const anchor of group.anchors) {
        const node = document.createElement("div");
        node.id = anchor.id;
        scroll.appendChild(node);
        rects.set(anchor.id, { top: index * 100 } as DOMRect);
      }
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rects.get(this.id) ?? ({ top: 0 } as DOMRect);
    });

    const activeGroups = () =>
      [...document.querySelectorAll<HTMLElement>(".settings-group-nav__title")]
        .filter((node) => node.getAttribute("aria-current") === "true")
        .map((node) => node.textContent ?? "")
        .join(",");

    const groupTitle = (index: number) => SETTINGS_GROUPS[index].title;
    const expectedFor = (offset: number) => {
      let current = 0;
      SETTINGS_GROUPS.forEach((_: unknown, index: number) => {
        const top = index * 100;
        if (top <= offset) current = index;
      });
      return groupTitle(current);
    };

    let root: Root | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SettingsGroupNav));
    });

    // 判定线 18 → 只有第 0 组（top 0）越过
    expect(activeGroups()).toBe(expectedFor(18));
    // CSS 值变 → 判定线跟着变（250 → 第 2 组也越过）。写死 56 的实现这里必红。
    scrollMarginTopValue = 250;
    await act(async () => {
      scroll.dispatchEvent(new Event("scroll"));
      /* rAF 节流是异步的：给它一个真实的宏任务窗口 */
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 30));
    });
    expect(activeGroups()).toBe(expectedFor(250));
    await act(async () => root?.unmount());
    container.remove();
  });
});
