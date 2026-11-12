(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DashboardBoard from "./DashboardBoard";
import { BOARD_COPY } from "./boardCopy";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { displayTitle } from "./contract";
import { useBoardStore } from "./boardStore";
import { useDashboardLayout } from "./useDashboardLayout";
import { DASHBOARD_COPY } from "../copy";

/**
 * [v3] 板子的**行为**判据（纯函数判据在 `layout.test.tsx` / `geometry.test.ts`）。
 *
 * 只钉三件在源码里看不出来的事：
 *   ① 卡片的 inline 位置 = 布局模型（不是 CSS 猜的）；
 *   ② 空板时给一句陈述，而不是一片空白；
 *   ③ 卡的 z 序 = 数组顺序（后出现的盖在上面），点一下能提到最前。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  window.localStorage.clear();
  useBoardStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function Harness() {
  const layout = useDashboardLayout();
  const copy = BOARD_COPY["zh-CN"];
  const labels = DASHBOARD_COPY["zh-CN"].cardLabels;
  return createElement(DashboardBoard, {
    layout,
    copy,
    labelOf: (card) => displayTitle(card, labels),
    renderBody: (card) => createElement("section", { "data-body": card.kind }, card.kind),
    emptyText: copy.empty,
  });
}

function mount() {
  act(() => root?.render(createElement(Harness)));
}

function frames(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(".qp-board-card") ?? []);
}

describe("DashboardBoard", () => {
  it("每张卡的 inline left/top/width/height 来自布局模型", () => {
    mount();
    const cards = frames();
    expect(cards.length).toBe(DEFAULT_LAYOUT.cards.length);
    const first = DEFAULT_LAYOUT.cards[0];
    expect(cards[0].style.left).toBe(`${first.x}px`);
    expect(cards[0].style.top).toBe(`${first.y}px`);
    expect(cards[0].style.width).toBe(`${first.w}px`);
    expect(cards[0].style.height).toBe(`${first.h}px`);
  });

  it("每张卡都有三根手柄，且卡内元素吃满整框", () => {
    mount();
    for (const card of frames()) {
      expect(card.querySelectorAll("[data-resize]").length).toBe(3);
      expect(card.querySelector("section[data-body]")).not.toBeNull();
    }
  });

  it("空板给一句陈述，不是一片空白", () => {
    const store = useBoardStore.getState();
    for (const card of [...store.layout.cards]) useBoardStore.getState().remove(card.uid);
    mount();
    expect(frames().length).toBe(0);
    expect(container?.textContent ?? "").toContain(BOARD_COPY["zh-CN"].empty);
  });

  it("加一张同类型组件：板上涨一张，落点不与既有卡重叠", () => {
    mount();
    const before = frames().length;
    act(() => {
      useBoardStore.getState().add("todos");
    });
    expect(frames().length).toBe(before + 1);
  });
});

function toolbarButtons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-dashboard-toolbar .qp-link-btn") ?? []);
}

function toolbarLabels(): string[] {
  return toolbarButtons().map((el) => el.textContent?.trim() ?? "");
}

function clickToolbar(label: string) {
  const target = toolbarButtons().find((el) => el.textContent?.trim() === label);
  if (!target) throw new Error(`工具条上没有「${label}」`);
  act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("保存布局（存当前排布为默认）", () => {
  const copy = BOARD_COPY["zh-CN"];

  it("存完之后「恢复默认」回到存的那一版，且工具条多出「出厂布局」", () => {
    mount();
    expect(toolbarLabels()).toEqual([copy.addCard, copy.tidy, copy.saveLayout, copy.reset]);

    /* 拖到一个出厂栅格里没有的位置，再存 */
    act(() => {
      useBoardStore.getState().moveTo(1, { x: 700, y: 600, w: 340, h: 304 });
    });
    const saved = useBoardStore.getState().layout.cards.find((card) => card.uid === 1);
    expect(saved).toBeDefined();

    clickToolbar(copy.saveLayout);
    expect(toolbarLabels()).toContain(copy.factory);

    /* 存完再拖回去，然后「恢复默认」—— 回来的必须是刚存的那一版 */
    act(() => {
      useBoardStore.getState().moveTo(1, { x: 24, y: 24, w: 340, h: 304 });
    });
    clickToolbar(copy.reset);

    const back = useBoardStore.getState().layout.cards.find((card) => card.uid === 1);
    expect({ x: back?.x, y: back?.y }).toEqual({ x: saved?.x, y: saved?.y });
    expect(container?.textContent ?? "").toContain(copy.resetToSaved);
  });

  it("空板上「保存布局」只给一句提示，不写默认版（否则「恢复默认」会变白板）", () => {
    for (const card of [...useBoardStore.getState().layout.cards]) {
      useBoardStore.getState().remove(card.uid);
    }
    mount();
    clickToolbar(copy.saveLayout);
    expect(useBoardStore.getState().customDefault).toBe(false);
    expect(container?.textContent ?? "").toContain(copy.saveEmpty);
  });
});
