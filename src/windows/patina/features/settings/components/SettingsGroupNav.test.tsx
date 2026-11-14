(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import SettingsGroupNav from "./SettingsGroupNav.tsx";
import { SETTINGS_GROUPS } from "../settingsGroups";

/**
 * 设置页分组导航的**判定算法**回归（[本轮]）。
 *
 * 这里复现的是真实 DOM 结构里那处致命错位：`s-interface` 嵌在 `s-display` 卡片内部
 * （`Settings.tsx` 的「接口」小节），因此它的文档位置**早于** `s-board-widgets`，而
 * `settingsGroups.ts` 把它登记在 `tracking` 组、排在 `s-board-widgets` **之后**。
 * 旧实现按表顺序遍历取"最后一个越过判定线"的锚点，于是滚到「主界面」区间时被
 * `s-interface` 覆盖成「计时与记录」——「主界面」永远不亮。
 *
 * 所以第一条判据就是：把错位结构原样搭出来，滚到「主界面」区间必须亮「主界面」。
 * 第二条：滚到容器底部必须亮最后一组（旧实现里 `s-general` 的 top 再也推不过判定线）。
 * 第三条：中间某组正常（防止"永远亮第一组/最后一组"也能过前两条）。
 * 第四条：内容一屏放得下时不许直接跳到最后一组（到底规则的 `canScroll` 前置条件）。
 * 第五条：判定线**真的**取自 CSS 的 `scroll-margin-top`（改成 4px 结论就变），
 *        防止有人把 `readActiveOffset()` 退回写死常量。
 *
 * 布局全靠 mock `getBoundingClientRect` + 自定义 `scrollTop/clientHeight/scrollHeight`：
 * jsdom 没有排版，真读 DOM 只会得到一堆 0，什么也证明不了。
 */

/** 各锚点的**文档绝对**纵坐标（px）。刻意保留 `s-interface` 的嵌套与靠前位置。 */
const ANCHOR_TOPS: Readonly<Record<string, number>> = {
  "s-pill-handles": 0,
  "s-pill-look": 80,
  "s-theme": 160,
  "s-highlight": 240,
  "s-display": 320,
  "s-interface": 380,
  "s-board-widgets": 520,
  "s-tracking": 700,
  "s-sync": 820,
  "s-backup": 900,
  "s-general": 1000,
  "s-resident": 1080,
  "s-plugins": 1140,
};

/** 内容总高：1200 > 视口 400，所以容器"确实还能滚" */
const CONTENT_HEIGHT = 1200;
const VIEWPORT_HEIGHT = 400;
/** `settings-handles.css` 里锚点真实的 `scroll-margin-top`（判定线的偏移） */
const CSS_ACTIVE_OFFSET = 18;

let scrollTop = 0;
let scrollHeight = CONTENT_HEIGHT;
let clientHeight = VIEWPORT_HEIGHT;
let activeOffset = CSS_ACTIVE_OFFSET;

let container: HTMLDivElement | null = null;
let scrollHost: HTMLDivElement | null = null;
let root: Root | null = null;
const realGetComputedStyle = window.getComputedStyle.bind(window);

/** 给一个元素装上"文档绝对坐标 − 当前滚动量"的 rect（jsdom 默认全 0） */
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

/** 搭出与 `Settings.tsx` 同构的滚动区（含 `s-interface` 嵌在 `s-display` 内部） */
function buildScrollHost() {
  const host = document.createElement("div");
  host.id = "settings-scroll";
  /* setter 必须真的写进去：`jump()` 现在**自己算 scrollTop**（不再 scrollIntoView），
     桩要是吞掉写入，"落点算得对不对"就成了一处测不到的空白。 */
  Object.defineProperty(host, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => { scrollTop = next; },
  });
  Object.defineProperty(host, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(host, "clientHeight", { configurable: true, get: () => clientHeight });
  /* 滚动容器**自己**的 rect 不随 scrollTop 变（真实浏览器里它在视口里的位置是固定的）：
     判定线 = 这个 top + `scroll-margin-top`，所以这里必须钉死 0。 */
  Object.defineProperty(host, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0, bottom: VIEWPORT_HEIGHT, left: 0, right: 600,
      width: 600, height: VIEWPORT_HEIGHT, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
  const make = (id: string, parent: HTMLElement) => {
    const section = document.createElement("section");
    section.id = id;
    pinTop(section, ANCHOR_TOPS[id]);
    parent.appendChild(section);
    return section;
  };
  make("s-pill-handles", host);
  make("s-pill-look", host);
  make("s-theme", host);
  make("s-highlight", host);
  const display = make("s-display", host);
  /* 真实结构：`s-interface` 在 `s-display` **卡片内部** —— 这正是串组的根因 */
  make("s-interface", display);
  make("s-board-widgets", host);
  make("s-tracking", host);
  make("s-sync", host);
  make("s-backup", host);
  make("s-general", host);
  make("s-resident", host);
  make("s-plugins", host);
  return host;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function scrollTo(nextScrollTop: number) {
  scrollTop = nextScrollTop;
  await act(async () => { scrollHost?.dispatchEvent(new Event("scroll")); });
  await settle();
}

/** 当前亮着那组的标题（`aria-current="true"` 必须**唯一**） */
function activeTitle(): string {
  const current = Array.from(document.querySelectorAll<HTMLElement>("[aria-current='true']"));
  expect(current).toHaveLength(1);
  return current[0].textContent ?? "";
}

async function mount() {
  scrollHost = buildScrollHost();
  document.body.appendChild(scrollHost);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(createElement(SettingsGroupNav)); });
  await settle();
}

beforeEach(() => {
  scrollTop = 0;
  scrollHeight = CONTENT_HEIGHT;
  clientHeight = VIEWPORT_HEIGHT;
  activeOffset = CSS_ACTIVE_OFFSET;
  /* jsdom 的 `getComputedStyle` 对 `scroll-margin-top` 一律回 "0"（cssstyle 没有这条属性），
     而真实应用里它是 `settings-handles.css` 给的 18。这里只替换**第一个锚点**的读数，
     其余元素照旧委托给真实现 —— `readActiveOffset()` 正是只看第一个锚点。 */
  window.getComputedStyle = ((element: Element) => (
    (element as HTMLElement).id === "s-pill-handles"
      ? ({ scrollMarginTop: `${activeOffset}px` } as CSSStyleDeclaration)
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

describe("SettingsGroupNav · 滚动高亮判定", () => {
  it("sg01_the_board_group_lights_up_even_though_s_interface_is_registered_later", async () => {
    await mount();
    /* 滚到「主界面」区间：s-board-widgets 顶到判定线（top = 520 − 520 = 0 ≤ 18）。
       旧算法在这里会被 s-interface（top = −140，登记在 tracking 组、排在 board 之后）
       覆盖成「计时与记录」—— 这就是本条判据的变异靶点。 */
    await scrollTo(520);
    expect(activeTitle()).toBe("主界面");
  });

  it("sg02_reaching_the_bottom_lights_the_last_group", async () => {
    await mount();
    /* 滚到底：scrollTop(800) + clientHeight(400) === scrollHeight(1200)。
       这一刻按纯几何算"最靠下的越线锚点"还是 s-tracking（top = −100），
       只有到底规则能把「通用与启动」点亮。 */
    await scrollTo(CONTENT_HEIGHT - VIEWPORT_HEIGHT);
    expect(activeTitle()).toBe("通用与启动");
  });

  it("sg03_a_middle_group_lights_up_normally", async () => {
    await mount();
    /* s-tracking(top = 700 − 690 = 10) 越过判定线，s-sync(130) 还在下面 */
    await scrollTo(690);
    expect(activeTitle()).toBe("计时与记录");
  });

  it("sg04_content_that_fits_never_jumps_to_the_last_group", async () => {
    /* 一屏放得下（scrollHeight === clientHeight）时 0 + clientHeight >= scrollHeight − 2 恒成立：
       到底规则必须被 canScroll 挡住，否则一进设置页就停在最后一组。 */
    scrollHeight = VIEWPORT_HEIGHT;
    await mount();
    expect(activeTitle()).toBe("悬浮条与手柄");
  });

  it("sg05_the_threshold_really_comes_from_css_scroll_margin_top", async () => {
    /* 判定线缩到 4px：s-tracking(top = 10) 不再越线，「计时与记录」区间里最靠下的越线锚点
       只剩 s-board-widgets(−170) → 亮「主界面」。结论跟着 CSS 走，说明判定线没被写死。 */
    activeOffset = 4;
    await mount();
    await scrollTo(690);
    expect(activeTitle()).toBe("主界面");
  });
});

/**
 * [本轮] 「点一组、亮另一组」的回归（用户报的那个形状）。
 *
 * 根因不是"点错了锚点"，而是**落点恰好压在判定线上**：`jump()` 的偏移与判定线读同一个
 * `scroll-margin-top`，理想落点是 `锚点 top === 判定线`（差值 0）。零容差下设备像素取整
 * 把落点推高 0.4px（`top = 判定线 + 0.4`）就判成"还没越线"，循环回落到上一个已越线锚点：
 * 点「主界面」→ 亮「计时与记录」，点「计时与记录」→ 亮「主界面」，完全对称。
 *
 * 两条判据都用**点击**驱动、偏差 ±0.4px：`+0.4` 是变异靶点（去掉 `LINE_TOLERANCE` 必红），
 * `−0.4` 在零容差实现下本来就绿，留着证明容差没把结论推向另一边。第三条盯「点击即钉住」的
 * **位置**语义（停在落点上不被抢、离开落点立刻交回几何）。
 */
describe("SettingsGroupNav · 点击跳转（落点压线 + 点击即钉住）", () => {
  /** 落点相对判定线的偏差（px）= `锚点 top − 判定线`；正 = 停在判定线下方 0.4px 那一半 */
  let landingDrift = 0;

  beforeEach(() => {
    landingDrift = 0;
    /* 给旧 `scrollIntoView` 路径留一份浏览器语义的桩：万一有人改回去，这里不会变成
       TypeError 假红，而是照旧按真实落点算高亮 —— 判据仍然咬得住。 */
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) {
      const id = (this as HTMLElement).id;
      scrollTop = (ANCHOR_TOPS[id] ?? 0) - CSS_ACTIVE_OFFSET - landingDrift;
      scrollHost?.dispatchEvent(new Event("scroll"));
    } as typeof Element.prototype.scrollIntoView;
  });

  const titleButton = (title: string) => Array.from(
    document.querySelectorAll<HTMLButtonElement>(".settings-group-nav__title"),
  ).find((button) => button.textContent === title);

  /** 点一下某组，再把「浏览器落定那一刻」的 scroll 事件如实打进场景 */
  async function clickGroup(title: string) {
    const group = SETTINGS_GROUPS.find((item) => item.title === title);
    expect(group, `分组表里没有「${title}」`).toBeDefined();
    const anchorId = group?.anchors[0]?.id ?? "";
    act(() => { titleButton(title)?.click(); });
    /* 落点 = 锚点顶到判定线 ± 设备像素取整（唯一变量）：`+0.4` 造出"还没越线"的那一半 */
    scrollTop = (ANCHOR_TOPS[anchorId] ?? 0) - CSS_ACTIVE_OFFSET - landingDrift;
    await act(async () => { scrollHost?.dispatchEvent(new Event("scroll")); });
    await settle();
  }

  it("sg06_a_landing_point_04px_below_the_line_still_lights_the_clicked_group", async () => {
    /* 变异靶点：把 `top <= line + LINE_TOLERANCE` 改回 `top <= line`，这一条必红
       （实测红：亮的是「计时与记录」，见交付说明里的原始输出）。 */
    landingDrift = 0.4;
    await mount();
    await clickGroup("主界面");
    expect(activeTitle()).toBe("主界面");
  });

  it("sg07_a_landing_point_04px_above_the_line_also_lights_the_clicked_group", async () => {
    landingDrift = -0.4;
    await mount();
    await clickGroup("计时与记录");
    expect(activeTitle()).toBe("计时与记录");
  });

  it("sg08_a_click_lights_the_group_and_the_pin_holds_only_while_it_sits_on_the_landing", async () => {
    /* [本轮] 钉住语义从「帧数」改成「位置」（见 `SettingsGroupNav.tsx` 文件头 ②）：停在落点上 →
       保持用户点的组；离开落点 → 立刻交回几何。跳转是瞬时的（无 `scroll-behavior: smooth`）。 */
    await mount();
    act(() => { titleButton("数据与同步")?.click(); });
    /* ① 点击**立刻**亮目标组：用户在等的是这个反馈，不是"滚完再看运气" */
    expect(activeTitle()).toBe("数据与同步");
    /* ② 还停在落点上（`jump()` 自己写下去的 802）→ 钉子有效，几何派生不许抢走高亮 */
    await scrollTo((ANCHOR_TOPS["s-sync"] ?? 0) - CSS_ACTIVE_OFFSET);
    expect(activeTitle()).toBe("数据与同步");
    /* ③ 离开落点 → 解钉，高亮按几何走（钉子不常驻） */
    await scrollTo(400);
    expect(activeTitle()).toBe("计时与记录");
    /* ④ 再滚回上面也一样跟着位置走 */
    await scrollTo(520);
    expect(activeTitle()).toBe("主界面");
  });
});
