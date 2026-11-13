(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DashboardBoard from "./DashboardBoard";
import { BOARD_COPY } from "./boardCopy";
import { displayTitle } from "./contract";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { useBoardStore } from "./boardStore";
import { useDashboardLayout } from "./useDashboardLayout";
import { DASHBOARD_COPY } from "../copy";

/**
 * [v3.1] Ctrl + 滚轮缩放 / 普通滚轮滚动 的**行为**判据。
 *
 * 源码形状在 `dashboardBoardLayout.test.ts`（p01c）里钉过；这里验的是"真的接上了"：
 * 事件打到滚动容器上，倍率真的变、transform 真的跟着变、普通滚轮不被吃掉
 * （吃掉就等于把滚动锁死 —— 正是用户报的"主界面滚轮无法翻动"）。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  window.localStorage.clear();
  useBoardStore.setState({ layout: cloneLayout(DEFAULT_LAYOUT) });
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
  const host = container?.querySelector<HTMLElement>(".qp-board-scroll");
  expect(host, "画布滚动容器没渲染出来").toBeTruthy();
  return host as HTMLElement;
}

function wheel(host: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  let prevented = false;
  act(() => {
    prevented = !host.dispatchEvent(event);
  });
  return prevented;
}

function zoomOf(host: HTMLElement): number {
  return Number(host.dataset.boardZoom);
}

describe("画布缩放（Ctrl + 滚轮）", () => {
  it("默认 100%：倍率不跟窗口大小联动", () => {
    const host = mount();
    expect(zoomOf(host)).toBe(1);
    const canvas = container?.querySelector<HTMLElement>(".qp-board-canvas");
    expect(canvas?.style.transform).toBe("scale(1)");
  });

  it("Ctrl + 滚轮向上放大，向下缩小，transform 同步跟着变", () => {
    const host = mount();
    expect(wheel(host, { ctrlKey: true, deltaY: -120 })).toBe(true);
    expect(zoomOf(host)).toBeGreaterThan(1);
    expect(container?.querySelector<HTMLElement>(".qp-board-canvas")?.style.transform)
      .toBe(`scale(${zoomOf(host)})`);

    const zoomedIn = zoomOf(host);
    expect(wheel(host, { ctrlKey: true, deltaY: 240 })).toBe(true);
    expect(zoomOf(host)).toBeLessThan(zoomedIn);
  });

  it("普通滚轮不拦：留给原生滚动（拦了就成'滚不动'）", () => {
    const host = mount();
    expect(wheel(host, { deltaY: -400 })).toBe(false);
    expect(zoomOf(host)).toBe(1);
  });

  it("倍率钳在 0.5–2，滚到底也不会把画布缩没", () => {
    const host = mount();
    for (let i = 0; i < 40; i += 1) wheel(host, { ctrlKey: true, deltaY: 400 });
    expect(zoomOf(host)).toBeGreaterThanOrEqual(0.5);
    for (let i = 0; i < 80; i += 1) wheel(host, { ctrlKey: true, deltaY: -400 });
    expect(zoomOf(host)).toBeLessThanOrEqual(2);
  });
});
