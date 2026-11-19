(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import SettingsGroupNav from "./SettingsGroupNav.tsx";
import { SETTINGS_GROUPS } from "../settingsGroups";
import {
  ANCHOR_TOPS,
  CSS_ACTIVE_OFFSET,
  FIRST_ANCHOR_ID,
  FIXTURE_ANCHOR_IDS,
} from "../settingsNavAnchors.test-utils";

/**
 * [QA 补测] 点击钉住语义的**边界**（`SettingsGroupNav.test.tsx` 只测了"停在落点/离开落点"
 * 两个基本点，`SettingsGroupNavPin.test.tsx` 只测"页尾落点被夹"）。
 *
 * 钉子（`pinnedLanding`）是**按位置**判的，所以真正的风险全在位置的边上：
 *   · 点的正好是"当前已经在的那一组"（落点 = 当前位置）→ 高亮不许跳；
 *   · 容差边上（落点 ±2 内 / ±3 外）必须一步切换，不许有第三个状态；
 *   · 内容一屏放得下（`scrollTop` 恒 0、永远不会再发 `scroll`）→ 高亮要跟着点击走，
 *     但**不许留钉**（留了就永远解不开，见 pe04）；
 *   · 连续点三组，前两次的落点不许残留；
 *   · 锚点节点不存在（`jump()` 里 `if (!container || !node) return` 那条路）→ 不许留钉子、
 *     也不许把高亮跳过去（[复核修复] 之前会跳，见 pe06）。
 *
 * `scrollTop` 用浏览器语义（夹到 `[0, maxScroll]`）—— 不夹的话"落点可达性"整个测不到。
 */

/** 锚点纵坐标与判定线偏移：共享自 `settingsNavAnchors.test-utils`（顺序按 IA 派生） */
/** 与组件里的 `BOTTOM_TOLERANCE` 同值 —— 钉子与到底判定共用 */
const TOLERANCE = 2;
let contentHeight = 1200;
let viewportHeight = 700;
let scrollTop = 0;
let host: HTMLDivElement | null = null;
let container: HTMLDivElement | null = null;
let root: Root | null = null;
const realGCS = window.getComputedStyle.bind(window);

const maxScroll = () => Math.max(0, contentHeight - viewportHeight);

function pinTop(element: HTMLElement, absoluteTop: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: absoluteTop - scrollTop, bottom: absoluteTop - scrollTop + 40,
      left: 0, right: 600, width: 600, height: 40,
      x: 0, y: absoluteTop - scrollTop, toJSON: () => ({}),
    }),
  });
}

function buildHost({ skip = [] as string[] } = {}) {
  const el = document.createElement("div");
  el.id = "settings-scroll";
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => { scrollTop = Math.min(Math.max(0, next), maxScroll()); },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => contentHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => viewportHeight });
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0, bottom: viewportHeight, left: 0, right: 600,
      width: 600, height: viewportHeight, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
  const make = (id: string, parent: HTMLElement) => {
    if (skip.includes(id)) return null;
    const section = document.createElement("section");
    section.id = id;
    pinTop(section, ANCHOR_TOPS[id]);
    parent.appendChild(section);
    return section;
  };
  /* 按 `FIXTURE_ANCHOR_IDS`（= `SETTINGS_ANCHOR_IDS` 页序）搭 DOM：写死列表会在 IA
     调整时静默漏掉新锚点、留下已删锚点，且顺序与导航判定顺序脱钩。 */
  for (const id of FIXTURE_ANCHOR_IDS) make(id, el);
  return el;
}

beforeEach(() => {
  scrollTop = 0;
  contentHeight = 1200;
  viewportHeight = 700;
  window.getComputedStyle = ((element: Element) => (
    (element as HTMLElement).id === FIRST_ANCHOR_ID
      ? ({ scrollMarginTop: `${CSS_ACTIVE_OFFSET}px` } as CSSStyleDeclaration)
      : realGCS(element as HTMLElement)
  )) as typeof window.getComputedStyle;
});

afterEach(() => {
  window.getComputedStyle = realGCS;
  act(() => root?.unmount());
  container?.remove();
  host?.remove();
  root = null; container = null; host = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function mount(options: { skip?: string[] } = {}) {
  host = buildHost(options);
  document.body.appendChild(host);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(createElement(SettingsGroupNav)); });
  await settle();
}

/** 一次「离散」滚动（按 Home / End、拖滚动条到位）：浏览器只发**一个** `scroll` */
async function oneScroll(next: number) {
  scrollTop = Math.min(Math.max(0, next), maxScroll());
  await act(async () => { host?.dispatchEvent(new Event("scroll")); });
  await settle();
}

function titleButton(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-group-nav__title"))
    .find((button) => button.textContent === title);
}

async function clickGroup(title: string) {
  expect(SETTINGS_GROUPS.some((group) => group.title === title), `分组表里没有「${title}」`).toBe(true);
  await act(async () => { titleButton(title)?.click(); });
  await settle();
}

function activeTitle(): string {
  const current = Array.from(document.querySelectorAll<HTMLElement>("[aria-current='true']"));
  expect(current, "`aria-current=\"true\"` 必须唯一").toHaveLength(1);
  return current[0].textContent ?? "";
}

describe("SettingsGroupNav · 钉住语义的边界", () => {
  it("pe01_clicking_the_group_you_are_already_on_does_not_move_the_highlight", async () => {
    /* 已经在底部（末组亮着）：再点一次「通用与启动」，落点被夹到 500 = 当前位置 */
    await mount();
    await oneScroll(maxScroll());
    expect(activeTitle()).toBe("通用与启动");
    await clickGroup("通用与启动");
    expect(scrollTop, "落点应为夹过的 500，不许写越界值").toBe(maxScroll());
    expect(activeTitle(), "点自己那一组不该换高亮").toBe("通用与启动");
    /* 随后滚开 → 立刻按几何走（钉子没黏住）：400 上最后一个越线锚点是 s-display */
    await oneScroll(400);
    expect(activeTitle(), "离开落点后高亮仍停在末组").toBe("外观与配色");
  });

  it("pe02_a_clamped_click_holds_on_one_scroll_event_and_releases_on_the_next", async () => {
    /* 「数据与同步」的落点 802 被夹到 500：**一个** scroll 事件就该让钉子生效 */
    await mount();
    await clickGroup("数据与同步");
    await oneScroll(maxScroll());
    expect(activeTitle(), "单次到底的 scroll 把钉子打掉了").toBe("数据与同步");
    /* 再一次滚到中途 → 立刻按几何派生（s-display 顶到判定线 → 外观与配色） */
    await oneScroll(300);
    expect(activeTitle(), "离开落点后没有立刻交回几何").toBe("外观与配色");
  });

  it("pe03_the_pin_releases_exactly_outside_the_two_px_tolerance", async () => {
    /* 落点被夹在 500（可滚量的上界，往下够不着），所以容差只能从**上面**探：
       498 在 ±2 内 → 保持用户点的组；497 出界 1px → 立刻交回几何（s-tracking 的 top = 203
       远在判定线外，最靠下的越线锚点是 s-display(−177) → 外观与配色）。 */
    await mount();
    await clickGroup("数据与同步");
    await oneScroll(maxScroll() - TOLERANCE);
    expect(activeTitle(), "±2 内的抖动不该解钉").toBe("数据与同步");
    await oneScroll(maxScroll() - TOLERANCE - 1);
    expect(activeTitle(), "超出容差 1px 仍未解钉（容差被放大或被改成常量以外的东西）").toBe("外观与配色");
  });

  it("pe04_content_that_fits_lights_the_clicked_group_and_pins_nothing", async () => {
    /* 一屏装得下（`maxScroll === 0`）：`scrollTop` 恒 0、`scroll` 事件永远不会再发 ——
       钉子一旦设上就再也解不开，高亮永久停在点的那一组，此后没有任何事件能纠正。
       所以这条路上**只点亮、不设钉**（见 `SettingsGroupNav.tsx` 文件头 [复核修复] ①）：
       `setActiveGroup(目标组)` 照旧（点了就亮），但**不写 `scrollTop`、不设 `pinnedLanding`**。
       判据是"点了就亮 + 不设钉"，**不是**几何派生（那条写法下点击完全没有反应）。
       变异靶点：把 `maxScroll === 0` 那条分支整段删掉（回到"照旧 setActiveGroup + 设钉"），
       最后一条 `toBe("悬浮条与手柄")` 立刻变成「通用与启动」（钉子钉死在 0 上，永不解开）。 */
    contentHeight = viewportHeight;
    await mount();
    expect(activeTitle()).toBe("悬浮条与手柄");
    await clickGroup("数据与同步");
    expect(scrollTop, "无滚动空间时写出了非 0 的 scrollTop").toBe(0);
    expect(activeTitle(), "一屏装得下时点击没有反馈（点了就亮是这条路的唯一判据）").toBe("数据与同步");
    /* 反馈跟着点击走，不是碰巧停在初始值：再点另一组 → 亮第二组 */
    await clickGroup("通用与启动");
    expect(activeTitle(), "第二次点击没把高亮带到第二组 —— 反馈没跟着点击走").toBe("通用与启动");
    /* 不设钉的那一半：来一个 `scroll`（缩放后浏览器补发 / 内容变高）必须立刻按几何派生。
       有钉的话这里会停在「通用与启动」上 —— 那正是"钉子永不解开"的形状。 */
    await oneScroll(0);
    expect(activeTitle(), "一屏装得下的点击留下了钉子：此后再也没有事件能解开它").toBe("悬浮条与手柄");
  });

  it("pe05_three_rapid_clicks_leave_the_third_group_and_no_residue_pin", async () => {
    /* 1600 − 400 = 1200 可滚：三个落点（982 / 142 / 802）都可达，互不相同 */
    contentHeight = 1600;
    viewportHeight = 400;
    await mount();
    await clickGroup("通用与启动");
    await clickGroup("外观与配色");
    await clickGroup("数据与同步");
    expect(scrollTop, "最终落点必须是第三组的 802").toBe(802);
    expect(activeTitle()).toBe("数据与同步");
    /* 第三组的落点仍然钉得住（前两次的落点没有抢走钉子） */
    await oneScroll(802);
    expect(activeTitle(), "第三个落点没钉住（钉子被前两次残留污染）").toBe("数据与同步");
    /* 滚到 700（计时与记录区间）→ 没有任何钉子残留 */
    await oneScroll(700);
    expect(activeTitle(), "第 1/2 次的钉子还在生效").toBe("计时与记录");
  });

  it("pe06_a_click_on_a_group_whose_anchor_is_missing_changes_nothing", async () => {
    /* `s-theme` / `s-highlight` / `s-display` 都不在 DOM 里（卡片没渲染）：
       点「外观与配色」→ `jump()` 取不到锚点节点。这种点击**什么也不该发生**
       （见 `SettingsGroupNav.tsx` 文件头 [复核修复] ②）：不改高亮、不写 `scrollTop`、不设钉。
       变异靶点：把 `setActiveGroup(groupId)` 挪回节点检查**之前** —— 第二条断言立刻红
       （旧现状就是"亮到点的那一组、页面没动"）。 */
    await mount({ skip: ["s-theme", "s-highlight", "s-display"] });
    const before = scrollTop;
    const beforeTitle = activeTitle();
    await clickGroup("外观与配色");
    expect(scrollTop, "找不到锚点却写了 scrollTop").toBe(before);
    expect(activeTitle(), "锚点节点缺失时高亮跳走了（亮了但页面没动）").toBe(beforeTitle);
    /* 关键：也没有留下钉子 —— 随便一次 scroll 立刻按几何派生回真实位置 */
    await oneScroll(0);
    expect(activeTitle(), "锚点缺失的点击留下了钉子").toBe("悬浮条与手柄");
  });

  it("pe07_the_bottom_rule_fires_at_max_scroll_minus_two_not_earlier", async () => {
    /* [QA 补测] `readActiveGroupId()` 抽成纯函数之后，「到底取末组」的触发点在哪一档？
       内容 1200 / 视口 700 → maxScroll = 500，到底判据是
       `scrollTop + clientHeight >= scrollHeight - BOTTOM_TOLERANCE(2)`：
         · 500（真正的底）→ 500 + 700 = 1200 >= 1198 → 末组
         · 498（差 2）→ 1198 >= 1198 → 末组（容差正好用满）
         · 497（差 3）→ 1197 < 1198 → 交回几何：s-tracking 的 top = 700 − 497 = 203，
           远在判定线 18 + LINE_TOLERANCE 2 = 20 之外 → 最靠下的越线锚点是 s-display → 外观与配色
       这一档同时钉住两件事：到底规则不会被 `LINE_TOLERANCE` 提前触发（497 上离 s-tracking
       还差 183px，两道容差都够不着），容差也不会多给一格（498 就到底）。 */
    await mount();
    await oneScroll(497);
    expect(activeTitle(), "到底规则提前 3px 触发（容差被放大）").toBe("外观与配色");
    await oneScroll(498);
    expect(activeTitle(), "差 2px 时到底规则该生效（`>= scrollHeight - 2`）").toBe("通用与启动");
    await oneScroll(500);
    expect(activeTitle(), "真正到底不是末组").toBe("通用与启动");
  });
});
