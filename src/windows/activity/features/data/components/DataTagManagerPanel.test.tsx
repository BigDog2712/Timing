import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTagTree } from "../../../../shared/tags/tagTree.ts";
import type { TagAdminState } from "../hooks/useTagAdmin.ts";
import DataTagManagerPanel from "./DataTagManagerPanel.tsx";

/**
 * 标签管理页的**交互**判据（[0.12.4]）。
 *
 * 这组钉的是「点下去到底调了什么」而不是「渲染出几行字」：
 *   · 新建 / 改名 / 删除必须落到 `state.create|rename|remove`，且参数是**完整路径**
 *     （只传末段名字会让后端把 `学习` 当成一级标签改名，子树全丢）；
 *   · 删除是「整行换确认条」而不是「按钮变红等第二下」—— 一次点击只进入确认态，
 *     说清删哪棵子树、摘掉多少条引用；只有「确认删除」才调 `remove`。
 *   · 搜索命中子孙时父节点仍在（否则树看起来"没搜到"）。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tags = ["娱乐", "娱乐/燕云", "学习/考公"];

function makeState(over: Partial<TagAdminState> = {}): TagAdminState {
  const tree = buildTagTree(tags.map((path) => ({ path, count: 1 })));
  return {
    tree,
    paths: ["娱乐", "娱乐/燕云", "学习", "学习/考公"],
    counts: { 娱乐: 1, "娱乐/燕云": 1, "学习/考公": 1 },
    loading: false,
    error: null,
    reload: vi.fn(async () => undefined),
    create: vi.fn(async () => []),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

function mount(state: TagAdminState) {
  act(() => root.render(createElement(DataTagManagerPanel, { state })));
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll("li"));
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "").includes(label),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("标签管理页", () => {
  it("shows the hierarchy with intermediate parents", () => {
    mount(makeState());
    const text = container.textContent ?? "";
    expect(text).toContain("娱乐");
    expect(text).toContain("燕云");
    expect(text).toContain("学习");
    expect(text).toContain("考公");
  });

  it("creates a tag with the full path typed by the user", async () => {
    const state = makeState();
    mount(state);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="新建标签路径"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, " 复盘/周报 ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(state.create).toHaveBeenCalledWith("复盘/周报");
  });

  it("renames with the whole path, not the leaf name", async () => {
    const state = makeState();
    mount(state);
    act(() => button("重命名 娱乐/燕云")!.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="重命名 娱乐/燕云"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "娱乐/永劫");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(state.rename).toHaveBeenCalledWith("娱乐/燕云", "娱乐/永劫");
  });

  /**
   * 删除的确认条必须是「独立一步」，不是「同一个按钮的第二形态」。
   *
   * 判据钉三件事：
   *   ① 点一次删除**不删**，原地出现确认条，并说清删哪棵子树、摘掉多少条引用；
   *   ② 取消之后行恢复原样，什么都没删；
   *   ③ 只有「确认删除」这一下才调 `remove`（且只调一次、参数是完整路径）。
   */
  it("deletes only from the inline confirm bar, not from the delete button", async () => {
    const state = makeState();
    mount(state);

    act(() => button("删除 娱乐/燕云")!.click());
    expect(state.remove, "第一次点击就删了").not.toHaveBeenCalled();
    const bar = container.textContent ?? "";
    expect(bar, "确认条没说清删的是哪棵树").toContain("删除「燕云」？");
    expect(bar, "确认条没报引用数").toContain("会从 1 条事项上摘掉");
    expect(bar).toContain("确认删除");

    act(() => button("取消")!.click());
    expect(container.textContent).not.toContain("会从 1 条事项上摘掉");
    expect(state.remove).not.toHaveBeenCalled();

    act(() => button("删除 娱乐/燕云")!.click());
    await act(async () => button("确认删除 娱乐/燕云")!.click());
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledWith("娱乐/燕云");
  });

  it("filters but keeps the parent of a matched child", () => {
    mount(makeState());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索标签"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "考公");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const text = container.textContent ?? "";
    expect(text).toContain("考公");
    expect(text).toContain("学习");
    expect(text).not.toContain("燕云");
  });

  it("shows the impact text for a subtree delete", () => {
    mount(makeState());
    expect(rows().length).toBeGreaterThan(0);
    expect(container.textContent).toContain("改名与删除都作用于整棵子树");
  });

  /**
   * [0.12.4 二改] 一行里有**两种**数，别再混成一个。
   *
   * 用户的原始反馈：`学习` 后面写着「0 条（含子标签）」，可它下面明明挂着 `考公` ——
   * 那个 0 是**引用数**，被读成了"子标签 0 个"。这里把三件事一起钉住：
   *   ① 引用数带单位（`N 条引用`），不是光秃秃的数字；
   *   ② 子标签数取**直接子节点个数**，父标签自身没有引用时也照样显示 `1 个子标签`；
   *   ③ 一行里的阅读顺序是 引用 → 子标签 → 改名 → 删除（用户口径）。
   */
  it("keeps reference count and sub-tag count apart, in that order", () => {
    mount(makeState({
      tree: buildTagTree([{ path: "学习/考公", count: 2 }]),
      paths: ["学习", "学习/考公"],
      counts: { "学习/考公": 2 },
    }));
    const parent = rows().find((row) => row.textContent?.includes("学习"))!;
    const text = parent.textContent ?? "";
    expect(text, "父标签的引用合计是子树合计（2）").toContain("2 条引用");
    expect(text, "子标签数应为直接子节点数 1").toContain("1 个子标签");
    expect(text, "不该把引用数说成子标签数").not.toContain("0 个子标签");

    const order = ["条引用", "个子标签", "改名", "删除"]
      .map((token) => text.indexOf(token));
    expect(order.every((index) => index >= 0), `行里缺了某个读数：${text}`).toBe(true);
    expect(order, `读数顺序不对：${text}`).toEqual([...order].sort((left, right) => left - right));
  });
});
