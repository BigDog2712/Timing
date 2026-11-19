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
 * [QA 补测] 点击跳转的**后续交互**（`SettingsGroupNav.test.tsx` 只测了"落定那一刻"）。
 *
 * 这一轮给 `jump()` 加了 `pin`（点击即钉住）与 `suppressBottomAt`。它们都是**有状态的**，
 * 所以风险不在"点一下对不对"，而在"点完之后用户接着滚"：
 *   ① 连续两次点不同组，第二次的结果不许被第一次的钉子串掉；
 *   ② 点完之后**一路滚到底**，末组必须亮（钉子不许赖着）；
 *   ③ 内容一屏装得下时（`scrollHeight <= clientHeight`）点击任一组，不许被"到底规则"改判。
 *
 * 与 `SettingsGroupNav.test.tsx` 的差别：这里的 `scrollTop` **像浏览器一样夹到 `[0, maxScroll]`**
 * （那边的桩是裸写，越界值会被原样记住）。落点可达性因此是真判据的一部分 ——
 * `qaPinStale`（落点被夹到底后单次滚动）是已知缺陷，另见 QA 报告，**故意不放在这里装绿**。
 */

/** 锚点纵坐标与判定线偏移：共享自 `settingsNavAnchors.test-utils`（顺序按 IA 派生） */
let contentHeight = 1600;
let viewportHeight = 400;
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

function buildHost() {
  const el = document.createElement("div");
  el.id = "settings-scroll";
  /* 浏览器语义：写入越界值会被夹住。`pin.landing` 存的是**未夹**的目标值，这正是
     已知缺陷 `qaPinStale` 的入口（见文件头）。 */
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
    const section = document.createElement("section");
    section.id = id;
    pinTop(section, ANCHOR_TOPS[id]);
    parent.appendChild(section);
    return section;
  };
  for (const id of FIXTURE_ANCHOR_IDS) make(id, el);
  return el;
}

beforeEach(() => {
  scrollTop = 0;
  contentHeight = 1600;
  viewportHeight = 400;
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
  for (let i = 0; i < 2; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function mount() {
  host = buildHost();
  document.body.appendChild(host);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(createElement(SettingsGroupNav)); });
  await settle();
}

/** 一次「离散」滚动（点滚动条 / 按 Home、End）：浏览器只发一次 `scroll` */
async function oneScroll(next: number) {
  scrollTop = Math.min(Math.max(0, next), maxScroll());
  await act(async () => { host?.dispatchEvent(new Event("scroll")); });
  await settle();
}

/** 连续滚动：一次手势会连发很多帧 `scroll`（钉子的帧数就是这么被消耗掉的） */
async function continuousScrollTo(next: number, frames = 16) {
  const from = scrollTop;
  const target = Math.min(Math.max(0, next), maxScroll());
  for (let i = 1; i <= frames; i += 1) {
    await oneScroll(from + ((target - from) * i) / frames);
  }
}

function titleButton(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-group-nav__title"))
    .find((button) => button.textContent === title);
}

function activeTitle(): string {
  const current = Array.from(document.querySelectorAll<HTMLElement>("[aria-current='true']"));
  expect(current, "`aria-current=\"true\"` 必须唯一").toHaveLength(1);
  return current[0].textContent ?? "";
}

describe("点击之后的后续交互（钉子与到底规则）", () => {
  it("qn01_two_consecutive_clicks_on_different_groups_do_not_interfere", async () => {
    await mount();
    act(() => { titleButton("计时与记录")?.click(); });
    await oneScroll(ANCHOR_TOPS["s-tracking"] - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("计时与记录");

    /* 第二次点击另一个组：第一次的钉子不许把高亮拉回去 */
    act(() => { titleButton("外观与配色")?.click(); });
    expect(activeTitle(), "第二次点击没有立刻生效").toBe("外观与配色");
    await oneScroll(ANCHOR_TOPS["s-theme"] - CSS_ACTIVE_OFFSET);
    expect(activeTitle(), "落定之后被上一组的钉子串掉").toBe("外观与配色");
  });

  it("qn02_scrolling_to_the_bottom_after_a_click_still_lights_the_last_group", async () => {
    await mount();
    act(() => { titleButton("计时与记录")?.click(); });
    await oneScroll(ANCHOR_TOPS["s-tracking"] - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("计时与记录");

    await continuousScrollTo(maxScroll());
    expect(activeTitle(), "一路滚到底之后钉子仍占着高亮").toBe("通用与启动");
  });

  it("qn03_content_that_fits_lights_each_clicked_group_and_pins_nothing", async () => {
    /* 一屏装得下：到底规则的 `canScroll` 前置条件必须挡住它（不许改判末组）；
       而这条路上**不许设钉**（[复核修复] ①：没有可滚空间、也不会再有 `scroll` 事件，
       设钉等于永久钉死）。判据是"点了就亮 + 不设钉"，**不是**几何派生 —— 后者会让点击
       完全没有反应。变异靶点：把 `maxScroll === 0` 那条分支整段删掉，最后一条断言立刻
       变成「计时与记录」（钉在 0 上，永不解开）。 */
    contentHeight = viewportHeight;
    await mount();
    act(() => { titleButton("通用与启动")?.click(); });
    await settle();
    expect(activeTitle(), "内容一屏装得下时点击被改判成末组").toBe("通用与启动");
    /* 反馈跟着点击走：再点另一组 → 亮第二组 */
    act(() => { titleButton("计时与记录")?.click(); });
    await settle();
    expect(activeTitle(), "反馈没跟着第二次点击走").toBe("计时与记录");
    /* 不设钉：来一个 `scroll` 必须立刻按几何派生（有钉的话这里停在「计时与记录」） */
    await oneScroll(0);
    expect(activeTitle(), "一屏装得下的点击留下了永不解开的钉子").toBe("悬浮条与手柄");
  });

  it("qn04_a_click_whose_landing_is_reachable_releases_the_pin_on_landing", async () => {
    /* 对照组：落点**可达**（`计时与记录` 的 landing = 682 <= maxScroll 1200）时，钉子必须在落定那一帧
       就解掉 —— 否则用户接着往上滚，高亮会黏在「计时与记录」上。 */
    await mount();
    act(() => { titleButton("计时与记录")?.click(); });
    expect(activeTitle(), "点击瞬间就该亮目标组").toBe("计时与记录");
    await oneScroll(ANCHOR_TOPS["s-tracking"] - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("计时与记录");
    await oneScroll(ANCHOR_TOPS["s-theme"] - CSS_ACTIVE_OFFSET);
    expect(activeTitle(), "落定后钉子未解，往上滚高亮不跟").toBe("外观与配色");
  });

  it("qn05_the_group_table_matches_the_page_after_the_entries_were_removed", () => {
    /* 判据算法整套都建立在"表顺序 = 页面顺序"上。[设置页七项改造·批 1/2] 两个入口下线后，
       表里只剩 5 组；「计时与记录」组也回到只有一个锚点。 */
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      "pill", "appearance", "tracking", "data", "general",
    ]);
    expect(SETTINGS_GROUPS.find((group) => group.id === "tracking")?.anchors.map((anchor) => anchor.id))
      .toEqual(["s-tracking"]);
  });
});
