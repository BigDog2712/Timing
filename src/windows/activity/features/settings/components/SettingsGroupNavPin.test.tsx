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
 * 点击后的「钉住」语义（QA 探针 `SettingsGroupNav.pinStale` 转正）。
 * -----------------------------------------------------------------------------
 * 与 `SettingsGroupNav.test.tsx` / `SettingsGroupNavClickFollow.test.tsx` 的差别只有两条，
 * 也正是缺陷的入口：
 *   ① `scrollTop` 的 setter **像浏览器一样夹到 `[0, maxScroll]`** —— 页尾那几个锚点
 *      （`s-general` 880 / `s-sync` 720）算出来的落点（862 / 702）**超过**
 *      `scrollHeight - clientHeight`（1200 − 700 = 500），写入会被夹到 500；
 *   ② 一次「离散」滚动只发**一个** `scroll` 事件 —— 用户按一次 `End` / `Home`、或者
 *      把滚动条直接拖到位，就是这样。滚动是瞬时的（设置页没有 `scroll-behavior: smooth`），
 *      所以这条路径是用户实际走的那条，而不是"连续抖 16 帧"。
 *
 * 旧实现把这两件事同时踩了：`pin.landing` 记的是**未夹**的原值（862），解钉条件是
 * `|scrollTop − pinned.landing| <= 2`，而 500 永远不等于 862 → 按位置**永远**解不了钉，
 * 只能等 `frames` 逐次扣完；`frames` 又按 `scroll` 事件数扣、不按时间，于是一次 `Home`
 * 只扣 1 帧，钉子还在，高亮仍停在"上一次点的那组"（pin01/pin02）。抖满 13 帧把钉子耗光之后，
 * `suppressBottomAt` 也因为同一个未夹取值早已被判"离开落点"清掉 → 到底规则接管 → 改判末组（pin05）。
 *
 * 每条用例都点名它咬住的机制；pin03 / pin04 在修复前后都是绿的，作为回归留着（防改坏）。
 */

/** 锚点纵坐标与判定线偏移：共享自 `settingsNavAnchors.test-utils`（顺序按 IA 派生） */
const CONTENT_HEIGHT = 1200;
const VIEWPORT_HEIGHT = 700;
/** 可达的最大滚动量：1200 − 700 = 500。页尾锚点的落点全部被夹在它上面 */
const MAX_SCROLL = CONTENT_HEIGHT - VIEWPORT_HEIGHT;

let scrollTop = 0;
let host: HTMLDivElement | null = null;
let container: HTMLDivElement | null = null;
let root: Root | null = null;
const realGCS = window.getComputedStyle.bind(window);

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

/** 搭出与 `Settings.tsx` 同构的滚动区，`scrollTop` 按**浏览器语义**夹到 `[0, maxScroll]` */
function buildHost() {
  const el = document.createElement("div");
  el.id = "settings-scroll";
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => { scrollTop = Math.min(Math.max(0, next), MAX_SCROLL); },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => CONTENT_HEIGHT });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => VIEWPORT_HEIGHT });
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0, bottom: VIEWPORT_HEIGHT, left: 0, right: 600,
      width: 600, height: VIEWPORT_HEIGHT, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
  const make = (id: string, parent: HTMLElement) => {
    const section = document.createElement("section");
    section.id = id;
    pinTop(section, ANCHOR_TOPS[id] ?? 0);
    parent.appendChild(section);
    return section;
  };
  for (const id of FIXTURE_ANCHOR_IDS) make(id, el);
  return el;
}

beforeEach(() => {
  scrollTop = 0;
  /* jsdom 的 `scroll-margin-top` 一律读成 0（cssstyle 没这条属性）：只替换第一个锚点的读数，
     其余委托真实现 —— `readActiveOffset()` 正是只看第一个锚点。 */
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
  root = null;
  container = null;
  host = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 3; i += 1) {
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

/** 一次「离散」滚动（按 `End` / `Home`、拖滚动条到位）：浏览器只发**一个** `scroll` 事件 */
async function oneScroll(nextScrollTop: number) {
  scrollTop = Math.min(Math.max(0, nextScrollTop), MAX_SCROLL);
  await act(async () => { host?.dispatchEvent(new Event("scroll")); });
  await settle();
}

function titleButton(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-group-nav__title"))
    .find((button) => button.textContent === title);
}

/** 点一下某组（`jump()` 自己写 `scrollTop`，这里不再补 scroll 事件） */
async function clickGroup(title: string) {
  expect(SETTINGS_GROUPS.some((group) => group.title === title), `分组表里没有「${title}」`).toBe(true);
  await act(async () => { titleButton(title)?.click(); });
  await settle();
}

/** 当前亮着那组的标题（`aria-current="true"` 必须**唯一**） */
function activeTitle(): string {
  const current = Array.from(document.querySelectorAll<HTMLElement>("[aria-current='true']"));
  expect(current, "`aria-current=\"true\"` 必须唯一").toHaveLength(1);
  return current[0].textContent ?? "";
}

describe("SettingsGroupNav · 点击后的钉住语义（落点被夹 + 单次滚动事件）", () => {
  it("pin01_a_tail_group_click_then_one_home_key_lights_the_first_group", async () => {
    /* 落点 = 880 − 18 = 862 > maxScroll 500 → 浏览器夹到 500。旧实现的 `pin.landing`
       记 862，与实际的 500 差 362px → 解钉条件永不成立。 */
    await mount();
    await clickGroup("通用与启动");
    await oneScroll(MAX_SCROLL);
    expect(activeTitle(), "落点被夹到底之后，用户点的组必须还亮着").toBe("通用与启动");
    /* 用户按一次 Home 回顶部：只发一个 scroll 事件 */
    await oneScroll(0);
    expect(activeTitle(), "回到顶部后仍亮着上一次点的组").toBe("计时行为");
  });

  it("pin02_a_data_group_click_then_one_home_key_lights_the_first_group", async () => {
    /* 与 pin01 同一条机制，落点 720 − 18 = 702（夹到 500），换了组名以便区分 */
    await mount();
    await clickGroup("数据与同步");
    await oneScroll(MAX_SCROLL);
    expect(activeTitle()).toBe("数据与同步");
    await oneScroll(0);
    expect(activeTitle(), "回到顶部后仍亮着「数据与同步」").toBe("计时行为");
  });

  it("pin03_two_consecutive_clicks_on_different_groups_do_not_interfere", async () => {
    /* 回归（修复前后都绿）：第一次的钉子不许把第二次的高亮拉回去 */
    await mount();
    await clickGroup("计时行为");
    await oneScroll(ANCHOR_TOPS["s-tracking"]! - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("计时行为");
    await clickGroup("外观与主题");
    await oneScroll(ANCHOR_TOPS["s-theme"]! - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("外观与主题");
  });

  it("pin04_a_click_on_a_group_whose_landing_is_unreachable_still_lights_it", async () => {
    /* 回归（修复前后都绿）：「悬浮条与把手」的落点 560 − 18 = 542 也被夹到 500，
       到底规则在此处本来会改判 —— 点击路径不许被它改判。 */
    await mount();
    await clickGroup("悬浮条与把手");
    expect(activeTitle()).toBe("悬浮条与把手");
    /* 抵达（被夹的）落点那一帧也只认用户点的组 */
    await oneScroll(MAX_SCROLL);
    expect(activeTitle(), "落点那一帧被到底规则改判").toBe("悬浮条与把手");
  });

  it("pin05_jittering_at_the_landing_never_rejudges_to_the_last_group", async () => {
    /* 用户停在落点上轻轻晃（每个 scroll 一个事件）：旧实现抖满 13 帧把钉住耗光、
       suppressBottomAt 早已被清 → 到底规则接管，改判末组。 */
    await mount();
    await clickGroup("数据与同步");
    await oneScroll(MAX_SCROLL);
    expect(activeTitle()).toBe("数据与同步");
    for (let i = 0; i < 14; i += 1) {
      await oneScroll(MAX_SCROLL - (i % 2 === 0 ? 1 : 0));
    }
    expect(activeTitle(), "pin 到期后到底规则把高亮改判成最后一组").toBe("数据与同步");
  });

  it("pin06_one_home_then_one_end_key_after_a_tail_click_is_correct_both_ways", async () => {
    /* 探针原本断言的是**缺陷现状**（点末尾组 → 回顶部仍亮末尾组，"点两次也救不回来"）。
       转正时按修复后的正确行为写死：一次 Home 就翻到首组，一次 End 再翻回末组。 */
    await mount();
    await clickGroup("通用与启动");
    await oneScroll(0);
    expect(activeTitle(), "点末尾组后单次回顶部：首组必须亮").toBe("计时行为");
    await oneScroll(MAX_SCROLL);
    expect(activeTitle(), "再单次回底部：末组必须亮").toBe("通用与启动");
  });
});
