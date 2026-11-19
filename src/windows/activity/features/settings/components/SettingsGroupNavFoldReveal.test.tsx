(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import SettingsGroupNav from "./SettingsGroupNav.tsx";
import { FoldBlock } from "./host/FoldBlock.tsx";
import {
  ANCHOR_TOPS,
  CSS_ACTIVE_OFFSET,
  FIRST_ANCHOR_ID,
  FIXTURE_ANCHOR_IDS,
} from "../settingsNavAnchors.test-utils";

/**
 * [B5c] 「折叠态下点导航 → 折叠块展开且滚动到位」。
 * -----------------------------------------------------------------------------
 * 为什么必须有这条：`s-pill-handles` 从 B5c 起是**默认折叠**的块。折叠体的 `hidden`
 * 让里面的一切不可见、不可聚焦，如果导航只是 `scrollIntoView`/写 `scrollTop`，用户点
 * 「把手绑定」看到的是一片"跳过去了但什么也没有"，而且**没有任何报错**。
 *
 * 这一条用真的 `FoldBlock` + 真的 `SettingsGroupNav` 跑完整条通路：
 *   点导航 → `jump()` 里 `flushSync(requestFoldReveal(anchorId))` → `FoldBlock` 展开
 *   → 再测落点 → 写 `scrollTop`。
 * 所以它同时钉住三件事：块真的展开、落点用的是**展开后**的可滚量、高亮落在被点的那组。
 *
 * 兄弟判据（各自咬不同的机制，不重复）：
 *   · `SettingsGroupNav*.test.tsx`：判定算法与钉住语义（夹具里没有折叠块，派发为空转）；
 *   · `settingsB5c.source.test.ts`：`SettingsHandlesPanel` 真的把卡片套进了 `FoldBlock`、
 *     且锚点 id 挂在块根节点（不是 `hidden` 的折叠体）—— 结构层面的前提；
 *   · 这里：那条通路真的把块打开了。
 *
 * 键盘：导航按钮是原生 `<button type="button" onClick>`，浏览器会把 `Enter` / `Space`
 * 转成 click，走的是**同一条** `jump()`（jsdom 不会替我们合成 click，所以下面的键盘用例
 * 断言的是"原生按钮 + 同一条点击通路"，而不是伪造一个 keydown 去等一个永不发生的 click）。
 */

const CONTENT_HEIGHT = 1200;
const VIEWPORT_HEIGHT = 400;
const FOLD_ANCHOR_ID = "s-pill-handles";

let scrollTop = 0;
let scrollHeight = CONTENT_HEIGHT;
let clientHeight = VIEWPORT_HEIGHT;

let container: HTMLDivElement | null = null;
let scrollHost: HTMLDivElement | null = null;
let root: Root | null = null;
const realGetComputedStyle = window.getComputedStyle.bind(window);

function pinTop(element: HTMLElement, absoluteTop: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: absoluteTop - scrollTop,
      bottom: absoluteTop - scrollTop + 40,
      left: 0,
      right: 600,
      width: 600,
      height: 40,
      x: 0,
      y: absoluteTop - scrollTop,
      toJSON: () => ({}),
    }),
  });
}

/**
 * 滚动区：除了 `s-pill-handles`（由 `FoldBlock` 自己提供）之外，按页序铺普通 `section`。
 * 折叠块不在这个容器里 —— 它在 React 树里跟导航一起渲染，但**几何**照样按 `ANCHOR_TOPS`
 * 钉住，`document.getElementById` 也是全文档查找，与真实页面同构。
 */
function buildScrollHost() {
  const host = document.createElement("div");
  host.id = "settings-scroll";
  Object.defineProperty(host, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => { scrollTop = next; },
  });
  Object.defineProperty(host, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(host, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(host, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0, bottom: VIEWPORT_HEIGHT, left: 0, right: 600,
      width: 600, height: VIEWPORT_HEIGHT, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
  for (const id of FIXTURE_ANCHOR_IDS) {
    if (id === FOLD_ANCHOR_ID) continue;
    const section = document.createElement("section");
    section.id = id;
    pinTop(section, ANCHOR_TOPS[id]);
    host.appendChild(section);
  }
  return host;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

function foldSection(): HTMLElement {
  const node = document.getElementById(FOLD_ANCHOR_ID);
  expect(node, `找不到锚点 ${FOLD_ANCHOR_ID}（折叠块没把 id 挂到根节点上）`).toBeTruthy();
  return node as HTMLElement;
}

function foldToggle(): HTMLButtonElement {
  const button = foldSection().querySelector<HTMLButtonElement>(".sync__fold-btn");
  expect(button, "找不到折叠块的开合按钮").toBeTruthy();
  return button as HTMLButtonElement;
}

function foldExpanded(): boolean {
  return foldToggle().getAttribute("aria-expanded") === "true";
}

function foldBodyHidden(): boolean {
  const body = document.getElementById(`${FOLD_ANCHOR_ID}-body`);
  expect(body, "找不到折叠体").toBeTruthy();
  return (body as HTMLElement).hidden;
}

function titleButton(title: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-group-nav__title"))
    .find((button) => button.textContent === title);
}

function activeTitle(): string {
  const current = Array.from(document.querySelectorAll<HTMLElement>("[aria-current='true']"));
  expect(current, "`aria-current=\"true\"` 必须唯一").toHaveLength(1);
  return current[0].textContent ?? "";
}

async function mount() {
  scrollHost = buildScrollHost();
  document.body.appendChild(scrollHost);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(
      "div",
      null,
      createElement(SettingsGroupNav),
      createElement(
        FoldBlock,
        {
          id: FOLD_ANCHOR_ID,
          title: "把手绑定",
          hint: "三形态 × 5 槽，改完即生效",
          children: createElement("p", null, "折叠体内容"),
        },
      ),
    ));
  });
  /* 折叠块的几何：与普通锚点用同一套阶梯，模拟"卡片在页面上的位置" */
  pinTop(foldSection(), ANCHOR_TOPS[FOLD_ANCHOR_ID]);
  await settle();
  /* 首帧 compute 跑在 rect 还是全 0 的时候，这里补一次，让状态与几何对齐 */
  await act(async () => { scrollHost?.dispatchEvent(new Event("scroll")); });
  await settle();
}

beforeEach(() => {
  scrollTop = 0;
  scrollHeight = CONTENT_HEIGHT;
  clientHeight = VIEWPORT_HEIGHT;
  window.getComputedStyle = ((element: Element) => (
    (element as HTMLElement).id === FIRST_ANCHOR_ID
      ? ({ scrollMarginTop: `${CSS_ACTIVE_OFFSET}px` } as CSSStyleDeclaration)
      : realGetComputedStyle(element as HTMLElement)
  )) as typeof window.getComputedStyle;
});

afterEach(() => {
  window.getComputedStyle = realGetComputedStyle;
  act(() => root?.unmount());
  container?.remove();
  scrollHost?.remove();
  container = null;
  scrollHost = null;
  root = null;
});

describe("[B5c] 折叠块（把手绑定）与导航的联动", () => {
  it("bf01_collapsed_by_default_and_the_anchor_sits_on_the_visible_header", async () => {
    /* 前提：默认折叠、折叠体 `hidden`；但锚点能找到、且在**折叠体之外**（否则导航
       会打在一个隐藏元素上，既不滚也不报错）。 */
    await mount();
    expect(foldExpanded(), "折叠块默认必须是收起的").toBe(false);
    expect(foldBodyHidden(), "收起时折叠体必须 `hidden`（块内控件不可聚焦）").toBe(true);
    const body = document.getElementById(`${FOLD_ANCHOR_ID}-body`) as HTMLElement;
    expect(foldSection().contains(body)).toBe(true);
    expect(foldSection() === body, "锚点 id 落在了折叠体上（隐藏元素）").toBe(false);
    expect(foldSection().tagName.toLowerCase()).toBe("section");
    /* 锚点元素的 rect 顶 = 块顶（可见头部），不是折叠体里 */
    expect(foldSection().getBoundingClientRect().top).toBe(ANCHOR_TOPS[FOLD_ANCHOR_ID]);
  });

  it("bf02_clicking_the_group_title_expands_the_fold_then_scrolls_to_the_landing", async () => {
    await mount();
    const expectedLanding = ANCHOR_TOPS[FOLD_ANCHOR_ID] - CSS_ACTIVE_OFFSET;

    act(() => { titleButton("悬浮条与把手")?.click(); });
    await settle();

    /* ① 块先展开：导航点的是标题，用户滚过去必须看得见里面的三张卡 */
    expect(foldExpanded(), "点导航没有展开折叠块").toBe(true);
    expect(foldBodyHidden(), "展开了但折叠体仍是 hidden").toBe(false);
    /* ② 再滚到「锚点顶到判定线」的落点（用展开后的可滚量算） */
    expect(scrollTop, "落点不是 锚点顶 − 判定线偏移").toBe(expectedLanding);
    /* ③ 高亮是被点的那一组 */
    expect(activeTitle()).toBe("悬浮条与把手");
  });

  it("bf03_a_manually_collapsed_fold_still_expands_again_from_the_nav", async () => {
    /* 「展开不受 defaultOpen 机制干扰」：用户手动收起后 `touched` 已为真，
       再点导航仍然要能展开（信号与 defaultOpen 是两条路）。 */
    await mount();
    act(() => { foldToggle().click(); });
    await settle();
    expect(foldExpanded()).toBe(true);
    act(() => { foldToggle().click(); });
    await settle();
    expect(foldExpanded(), "手动收起失败（前置条件没成立）").toBe(false);

    act(() => { titleButton("悬浮条与把手")?.click(); });
    await settle();
    expect(foldExpanded(), "手动收起之后再点导航，块没有重新展开").toBe(true);
  });

  it("bf04_clicking_another_group_never_expands_this_fold", async () => {
    /* 反面：信号按锚点 id 精确匹配，别的组不该被顺手展开（否则「点哪都展开」） */
    await mount();
    act(() => { titleButton("数据与同步")?.click(); });
    await settle();
    expect(foldExpanded()).toBe(false);
    expect(activeTitle()).toBe("数据与同步");
    expect(scrollTop).toBe(ANCHOR_TOPS["s-sync"] - CSS_ACTIVE_OFFSET);
  });

  it("bf05_the_group_title_is_a_native_button_so_enter_and_space_go_through_the_same_jump", async () => {
    /* 键盘可达：原生 `<button>` + `type="button"`，浏览器把 Enter / Space 转成 click，
       走的就是上面那条 `jump()`。jsdom 不合成这个 click，所以这里断言"原生按钮"这个
       前提（而不是伪造 keydown 去等一个不会发生的 click）。 */
    await mount();
    const button = titleButton("悬浮条与把手");
    expect(button, "找不到「悬浮条与把手」的导航按钮").toBeTruthy();
    expect(button?.tagName.toLowerCase()).toBe("button");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.hasAttribute("disabled")).toBe(false);
    /* 同一个 handler：走 click 等效于走 Enter/Space */
    act(() => { button?.click(); });
    await settle();
    expect(foldExpanded()).toBe(true);
  });
});
