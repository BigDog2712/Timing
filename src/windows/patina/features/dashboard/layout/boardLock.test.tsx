(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardCardFrame, { type DragMode } from "./BoardCardFrame";
import CardMenu from "./CardMenu";
import LayoutManagerDialog from "./LayoutManagerDialog";
import { BOARD_COPY } from "./boardCopy";
import { useBoardStore } from "./boardStore";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { emptyLibrary, FACTORY_LAYOUT_ID } from "./library";
import type { Rect } from "./contract";

/**
 * [0.13 · 需求 1.3 / 1.4] 锁定与布局管理的判据（V-1.3a~d / V-1.4d / V-3a）。
 * 锁定口径（本轮裁决）：几何锁 + 结构锁 —— 禁 拖动/改尺寸/整理/加删组件/复制/换档/
 * 切删建布局；许 改卡标题、改卡内参数。死锁防线：锁定后工具条必须仍可点。
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

const COPY = BOARD_COPY["zh-CN"];

function readCss(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/* ── V-1.3a：store 层的几何锁 / 结构锁 ── */

describe("V-1.3a 锁定后六个动作都不改 layout 引用", () => {
  it("v13a_locked_blocks_move_resize_tidy_add_remove_duplicate", () => {
    useBoardStore.setState({ locked: true });
    const before = useBoardStore.getState().layout;
    const uid = before.cards[0].uid;
    const store = useBoardStore.getState();

    expect(store.add("todos")).toBe(-1);
    expect(store.duplicate(uid)).toBeNull();
    store.remove(uid);
    store.moveTo(uid, { x: 100, y: 100, w: 340, h: 304 });
    store.setTier(uid, "S");
    store.tidy();

    /* 引用相等，而不是"值相等"：值相等会漏掉"先改再改回来"这类空转，
     * 而引用相等只要真写过一次就会红。 */
    expect(useBoardStore.getState().layout).toBe(before);
  });

  it("v13a_locked_still_allows_title_and_options", () => {
    useBoardStore.setState({ locked: true });
    const uid = useBoardStore.getState().layout.cards[0].uid;

    useBoardStore.getState().setTitle(uid, "上午的会议");
    expect(useBoardStore.getState().layout.cards[0].title).toBe("上午的会议");

    useBoardStore.getState().setOption(uid, "dimension", "app");
    expect(useBoardStore.getState().layout.cards[0].options).toEqual({ dimension: "app" });
  });

  it("v13a_locked_blocks_layout_library_writes", () => {
    useBoardStore.setState({ locked: true });
    const before = useBoardStore.getState().library;

    expect(useBoardStore.getState().createLayout("布局 1")).toBe(false);
    useBoardStore.getState().switchToLayout(FACTORY_LAYOUT_ID);
    useBoardStore.getState().removeLayout(FACTORY_LAYOUT_ID);

    expect(useBoardStore.getState().library).toBe(before);
  });

  it("v13a_unlocking_restores_dragging", () => {
    useBoardStore.setState({ locked: true });
    useBoardStore.getState().setLocked(false);
    const uid = useBoardStore.getState().layout.cards[0].uid;
    useBoardStore.getState().moveTo(uid, { x: 104, y: 104, w: 340, h: 304 });
    expect(useBoardStore.getState().layout.cards[0].x).toBe(104);
    /* 解锁状态要落盘：否则下次开窗又变成锁着（用户会以为解锁没生效） */
    expect(window.localStorage.getItem("patina:dashboard-layout:locked:v1")).toBe("0");
  });
});

/* ── V-1.3b：卡头 ⋯ 菜单里只禁结构三项 ── */
describe("V-1.3b 锁定态卡头菜单", () => {
  function mountMenu(locked: boolean) {
    act(() => {
      root?.render(createElement(CardMenu, {
        label: "待办事项",
        title: "",
        tier: "M",
        copy: COPY,
        locked,
        onTier: () => undefined,
        onRename: () => undefined,
        onDuplicate: () => undefined,
        onRemove: () => undefined,
      }));
    });
    const trigger = container?.querySelector<HTMLButtonElement>(".qp-card-more");
    if (!trigger) throw new Error("没有 ⋯ 触发键");
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function menuItems(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>(".qp-card-menu-item"));
  }

  it("v13b_structural_actions_are_disabled_but_title_stays_editable", () => {
    mountMenu(true);
    const items = menuItems();
    /* 3 档尺寸 + 复制 + 移除 = 5 颗按钮，另有 1 个 input（标题） */
    expect(items.length).toBe(5);
    for (const item of items) expect(item.disabled).toBe(true);
    const input = document.body.querySelector<HTMLInputElement>(".qp-card-menu-input");
    expect(input?.disabled).toBe(false);
  });

  it("v13b_unlocked_menu_is_fully_clickable", () => {
    mountMenu(false);
    const items = menuItems();
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) expect(item.disabled).toBe(false);
  });
});

/* ── V-1.3c：死锁（锁定后工具条必须仍可点） ── */
describe("V-1.3c 锁定态工具条仍可点（不许 pointer-events: none）", () => {
  it("v13c_lock_button_is_never_disabled_nor_pointer_events_none", () => {
    /* 三颗键在锁定态都必须 disabled=false（工具条本体由 DashboardBoard 渲染，
     * 其可点性在 board.test.tsx 的 v14c 里测）。 */
    const buttons = [
      createElement("button", { type: "button", className: "qp-link-btn", "data-toolbar-add": true }, COPY.addCard),
      createElement("button", { type: "button", className: "qp-link-btn", "data-toolbar-manage": true }, COPY.manageLayout),
      createElement("button", { type: "button", className: "qp-link-btn", "data-toolbar-lock": true }, COPY.lockLayout),
    ];
    act(() => {
      root?.render(createElement("div", { className: "qp-page-toolbar qp-dashboard-toolbar", "data-locked": true }, ...buttons));
    });
    for (const el of Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-link-btn") ?? [])) {
      expect(el.disabled).toBe(false);
      expect(getComputedStyle(el).pointerEvents).not.toBe("none");
    }
  });

  it("v13c_toolbar_css_never_disables_pointer_events", () => {
    /* 源码判据（死锁的唯一机械保证：jsdom 不加载样式表，量不出继承） */
    const rules = readCss("../../../shell/styles/features/dashboard-r2.css");
    expect(rules).toContain(".qp-page-toolbar");
    expect(rules).not.toMatch(/\.qp-page-toolbar[^{]*\{[^}]*pointer-events:\s*none/);
  });
});

/* ── V-1.3d：卡框在锁定态不接受抓取、也不渲染手柄 ── */
describe("V-1.3d 卡框在锁定态", () => {
  function mountFrame(locked: boolean, onBegin: (m: DragMode) => void) {
    act(() => {
      root?.render(createElement(BoardCardFrame, {
        card: DEFAULT_LAYOUT.cards[0],
        label: "计时分布",
        copy: COPY,
        dragging: false,
        locked,
        onBegin: (_event, _rect: Rect, mode) => onBegin(mode),
        onNudge: () => undefined,
        children: createElement("div", { className: "qp-card-head" }, "卡头"),
      }));
    });
  }

  it("v13d_locked_renders_no_handles_and_ignores_drag", () => {
    const onBegin = vi.fn();
    mountFrame(true, onBegin);
    const card = container?.querySelector<HTMLElement>(".qp-board-card");
    expect(card?.querySelectorAll("[data-resize]").length).toBe(0);
    expect(card?.getAttribute("data-locked")).toBe("true");

    const head = container?.querySelector<HTMLElement>(".qp-card-head");
    if (!head) throw new Error("没有卡头");
    act(() => {
      head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(onBegin).not.toHaveBeenCalled();
  });

  it("v13d_unlocked_renders_three_handles_and_drags_from_the_head", () => {
    const onBegin = vi.fn();
    mountFrame(false, onBegin);
    expect(container?.querySelectorAll("[data-resize]").length).toBe(3);

    const head = container?.querySelector<HTMLElement>(".qp-card-head");
    if (!head) throw new Error("没有卡头");
    act(() => {
      head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(onBegin).toHaveBeenCalledWith("move");
  });
});

/* ── V-3a（回归）：卡里的输入控件永远不是拖卡热区 ── */
describe("V-3a 卡内交互元素不触发拖卡", () => {
  it("v3a_pointerdown_on_an_input_inside_the_head_does_not_begin_a_drag", () => {
    const onBegin = vi.fn();
    function Harness() {
      const [value] = useState("");
      return createElement(BoardCardFrame, {
        card: DEFAULT_LAYOUT.cards[0],
        label: "待办事项",
        copy: COPY,
        dragging: false,
        locked: false,
        onBegin: () => onBegin(),
        onNudge: () => undefined,
        children: createElement(
          "div",
          { className: "qp-card-head" },
          createElement("input", { className: "qp-probe", value, readOnly: true }),
        ),
      });
    }
    act(() => {
      root?.render(createElement(Harness));
    });
    const input = container?.querySelector<HTMLElement>(".qp-probe");
    if (!input) throw new Error("没有输入框");
    act(() => {
      input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(onBegin).not.toHaveBeenCalled();
  });
});

/* ── V-1.4d：布局管理弹层里的「整理」 ── */
describe("V-1.4d 布局管理弹层", () => {
  function mountManager(locked: boolean, handlers: { onTidy: () => void; onCreate: () => void }) {
    act(() => {
      root?.render(createElement(LayoutManagerDialog, {
        copy: COPY,
        library: emptyLibrary(),
        locked,
        canCreate: true,
        onSwitch: () => undefined,
        onCreate: handlers.onCreate,
        onRemove: () => undefined,
        onTidy: handlers.onTidy,
        onClose: () => undefined,
      }));
    });
  }

  it("v14d_tidy_is_in_the_manager_and_calls_tidy", () => {
    const onTidy = vi.fn();
    mountManager(false, { onTidy, onCreate: () => undefined });
    const tidy = container?.querySelector<HTMLButtonElement>("[data-layout-tidy]");
    expect(tidy?.textContent?.trim()).toBe(COPY.tidy);
    act(() => {
      tidy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onTidy).toHaveBeenCalledTimes(1);
  });

  it("v14d_tidy_and_create_are_disabled_while_locked", () => {
    mountManager(true, { onTidy: () => undefined, onCreate: () => undefined });
    expect(container?.querySelector<HTMLButtonElement>("[data-layout-tidy]")?.disabled).toBe(true);
    expect(container?.querySelector<HTMLButtonElement>("[data-layout-create]")?.disabled).toBe(true);
    /* 锁定态要给一句解释，否则用户只看到一片灰 */
    expect(container?.textContent ?? "").toContain(COPY.lockedHint);
  });

  it("v14d_factory_entry_is_built_in_and_has_no_delete_key", () => {
    mountManager(false, { onTidy: () => undefined, onCreate: () => undefined });
    const factoryRow = container?.querySelector(`[data-layout-entry="${FACTORY_LAYOUT_ID}"]`);
    expect(factoryRow).not.toBeNull();
    expect(factoryRow?.querySelector("[data-layout-delete]")).toBeNull();
    expect(factoryRow?.textContent ?? "").toContain(COPY.factoryLayoutName);
  });
});
