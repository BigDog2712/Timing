(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAYOUT_STORAGE_KEY, type CardId } from "./contract";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import AddCardDialog from "./AddCardDialog";
import { loadLayout, saveLayout } from "./layoutStore";
import { normalizeLayout } from "./normalizeLayout";

/**
 * [P1 · 0.12.1] B3 / B6 的**行为**侧判据（纯函数判据在 `layout.test.tsx`）。
 *
 * 仓库没有 `@testing-library`，所以照 `HostTimingStatusRow.test.tsx` 的既有做法用
 * `react-dom/client` + `act` 直接挂载 —— 不为一个弹层引入新的依赖树。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  window.localStorage.clear();
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

function mount(element: Parameters<Root["render"]>[0]) {
  act(() => root?.render(element));
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []);
}

describe("AddCardDialog", () => {
  it("b03b_adding_a_card_persists_it", () => {
    saveLayout(DEFAULT_LAYOUT);
    const added: string[] = [];
    mount(
      createElement(AddCardDialog, {
        present: () => false,
        onAdd: (id: CardId) => {
          added.push(id);
          const current = loadLayout().layout;
          saveLayout({ ...current, cards: [...current.cards, { id, column: "full", tier: "M" }] });
        },
        onClose: () => {},
      }),
    );

    /* 只列**真能渲染**的卡：trend / reminder 已从目录里筛掉（上一版加了它们只得到空槽） */
    const target = buttons().find((button) => button.textContent?.includes("事项菜单"));
    expect(target).toBeTruthy();
    act(() => target?.click());

    expect(added).toEqual(["timeline"]);
    const stored = normalizeLayout(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null"));
    expect(stored.layout.cards.map((card) => card.id)).toContain("timeline");
  });

  it("b06a_dialog_lists_only_absent_cards_and_focuses_the_first", () => {
    mount(
      createElement(AddCardDialog, {
        present: (id: CardId) => id === "timer" || id === "notes",
        onAdd: () => {},
        onClose: () => {},
      }),
    );

    /* 已在板上的两张不出现；其余五张在。 */
    expect(buttons().some((button) => button.textContent?.includes("专注窗口"))).toBe(false);
    expect(buttons().some((button) => button.textContent?.includes("便利贴窗口"))).toBe(false);
    const items = buttons().filter((button) => button.className.includes("qp-add-card__item"));
    /* 目录 8 张 - 已在板上 2 张（timer / notes）= 6 张。
     * 历史两笔：① 目录原漏 `items`，移除事项卡后它在列表里彻底消失（`isCardKnown` 靠本表查
     * column）；② `trend` / `reminder` 原先渲染返回 null，点「添加」只得到看不见的空槽 ——
     * 0.12.1 起两张卡都真渲染了，所以它们**必须**出现在这里，过滤口径只剩"不在板上"。 */
    expect(items).toHaveLength(6);
    expect(buttons().some((button) => button.textContent?.includes("应用趋势"))).toBe(true);
    expect(buttons().some((button) => button.textContent?.includes("提醒窗口"))).toBe(true);
    /* 焦点落在第一项：打开就能 Tab/Enter，不必先点一下。 */
    expect(document.activeElement).toBe(items[0]);
  });
});
