(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DashboardBoard from "./DashboardBoard";
import { BOARD_COPY } from "./boardCopy";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { displayTitle } from "./contract";
import { useBoardStore } from "./boardStore";
import { emptyLibrary } from "./library";
import { useDashboardLayout } from "./useDashboardLayout";
import { DASHBOARD_COPY } from "../copy";

/**
 * [v3] 板子的**行为**判据（纯函数判据在 `layout.test.tsx` / `geometry.test.ts`）。
 *
 * 只钉三件在源码里看不出来的事：
 *   ① 卡片的 inline 位置 = 布局模型（不是 CSS 猜的）；
 *   ② 空板时给一句陈述，而不是一片空白；
 *   ③ 卡的 z 序 = 数组顺序（后出现的盖在上面），点一下能提到最前。
 *
 * [0.13 · 需求 1.4] 工具条从 5 颗（含「整理 / 保存布局 / 恢复默认 / 出厂布局」）
 * 收成 **3 颗**：添加组件 / 布局管理 / 锁定布局。整理与布局库动作搬进了
 * `LayoutManagerDialog`（判据在 `boardLock.test.tsx` 的 V-1.4d）。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  window.localStorage.clear();
  useBoardStore.setState({
    layout: cloneLayout(DEFAULT_LAYOUT),
    locked: false,
    library: emptyLibrary(),
    libraryHydrated: false,
  });
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

function toolbarButtons(): HTMLButtonElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLButtonElement>(".qp-page-toolbar .qp-link-btn") ?? [],
  );
}

function toolbarLabels(): string[] {
  return toolbarButtons().map((el) => el.textContent?.trim() ?? "");
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
    for (const card of [...useBoardStore.getState().layout.cards]) {
      useBoardStore.getState().remove(card.uid);
    }
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

/**
 * V-1.4c：工具栏**只有三颗**按钮，文案分别是 addCard / manageLayout / lockLayout。
 * 为什么钉「恰好三颗」而不是「包含三颗」：需求的原话是"工具栏只留三项"，多出来的
 * 任何一颗（尤其"恢复默认"这种破坏性动作）都不该在右上角随手可点。
 */
describe("工具条三入口", () => {
  const copy = BOARD_COPY["zh-CN"];

  it("v14c_toolbar_has_exactly_three_entries", () => {
    mount();
    expect(toolbarButtons().length).toBe(3);
    expect(toolbarLabels()).toEqual([copy.addCard, copy.manageLayout, copy.lockLayout]);
  });

  it("v14c_toolbar_uses_the_shared_page_toolbar_container", () => {
    mount();
    const toolbar = container?.querySelector<HTMLElement>(".qp-page-toolbar");
    expect(toolbar).not.toBeNull();
    /* 修饰类保留 `qp-dashboard-toolbar`：位置（贴板子左上角）靠它，
     * 几何与淡显靠 `.qp-page-toolbar`（设置页复用同一套）。 */
    expect(toolbar?.classList.contains("qp-dashboard-toolbar")).toBe(true);
  });

  it("v14c_lock_toggle_flips_label_and_store", () => {
    mount();
    const lockButton = (): HTMLButtonElement => {
      const found = toolbarButtons().find((el) => el.matches("[data-toolbar-lock]"));
      if (!found) throw new Error("工具条上没有锁定键");
      return found;
    };
    expect(lockButton().textContent?.trim()).toBe(copy.lockLayout);

    act(() => {
      lockButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useBoardStore.getState().locked).toBe(true);
    expect(lockButton().textContent?.trim()).toBe(copy.unlockLayout);
    expect(container?.textContent ?? "").toContain(copy.layoutLocked);

    act(() => {
      lockButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useBoardStore.getState().locked).toBe(false);
    expect(lockButton().textContent?.trim()).toBe(copy.lockLayout);
    expect(container?.textContent ?? "").toContain(copy.layoutUnlocked);
  });

  it("v14c_manage_entry_opens_the_layout_manager", () => {
    mount();
    expect(container?.querySelector(".qp-layout-manager")).toBeNull();
    const manage = toolbarButtons().find((el) => el.matches("[data-toolbar-manage]"));
    if (!manage) throw new Error("工具条上没有布局管理键");
    act(() => {
      manage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container?.querySelector(".qp-layout-manager")).not.toBeNull();
    /* 内置的出厂条目永远在列表里（删不掉、是删当前布局的唯一落点） */
    expect(container?.querySelector('[data-layout-entry="factory"]')).not.toBeNull();
    expect(container?.textContent ?? "").toContain(copy.factoryLayoutName);
  });
});
