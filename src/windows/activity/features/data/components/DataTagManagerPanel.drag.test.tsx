import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTagTree } from "../../../../shared/tags/tagTree.ts";
import type { TagAdminState } from "../hooks/useTagAdmin.ts";
import DataTagManagerPanel from "./DataTagManagerPanel.tsx";

/**
 * 拖动改分类的**交互**判据。
 *
 * 这组钉的是三件事，而不是"渲染出几行字"：
 *   ① 一次成功的拖动最终只落成**一次** `state.rename(from, next)` ——
 *      拖动不是新的 IPC，它就是改名（后端一个事务带整棵子树）；
 *   ② 拖进自己的子树里**一次都不调** `state.rename`，并且页面出现一句人话
 *      （列成"环"这种结构性错误必须在下手之前挡住，不能让后端去拒）；
 *   ③ 搜索态下行不能拖（`draggable=false`），且页面说清为什么 ——
 *      搜索结果是过滤后的树，缺父子上下文。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tags = ["娱乐", "娱乐/燕云", "学习/考公"];

function makeState(over: Partial<TagAdminState> = {}): TagAdminState {
  return {
    tree: buildTagTree(tags.map((path) => ({ path, count: 1 }))),
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

/**
 * jsdom 没有 `DragEvent`，也没有 `DataTransfer`：造一个带 `dataTransfer` 的普通
 * Event 就够 —— React 的合成事件是**直接读**原生事件上的 `dataTransfer`。
 */
function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      dropEffect: "none",
      effectAllowed: "all",
      setData: () => undefined,
      getData: () => "",
    },
  });
  return event;
}

let container: HTMLDivElement;
let root: Root;

function mount(state: TagAdminState) {
  act(() => root.render(createElement(DataTagManagerPanel, { state })));
}

/** 行根节点带 `data-path`：拖拽落点的身份靠它认，不靠文案 */
function row(path: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-path="${path}"]`);
}

function setInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("标签管理 · 拖动改分类", () => {
  it("拖到另一行上 = 变成它的子标签，rename 一次，参数是完整路径与新路径", async () => {
    const state = makeState();
    mount(state);

    act(() => row("娱乐/燕云")!.dispatchEvent(dragEvent("dragstart")));
    const target = row("学习/考公")!;
    expect(target.getAttribute("data-drop-target"), "还没悬停就标了可投放").toBe("none");

    act(() => target.dispatchEvent(dragEvent("dragover")));
    expect(target.getAttribute("data-drop-target"), "可投放的行没有标记").toBe("ok");

    await act(async () => {
      target.dispatchEvent(dragEvent("drop"));
    });

    expect(state.rename, "拖动应当落成一次改名").toHaveBeenCalledTimes(1);
    expect(state.rename).toHaveBeenCalledWith("娱乐/燕云", "学习/考公/燕云");
    expect(state.create, "拖动不该新建标签").not.toHaveBeenCalled();
    expect(container.textContent).toContain("已把 #娱乐/燕云 移到 #学习/考公/燕云");
  });

  it("拖进自己的子树里：一次 rename 都不调，页面给一句人话说清是环", async () => {
    const state = makeState();
    mount(state);

    act(() => row("学习")!.dispatchEvent(dragEvent("dragstart")));
    const target = row("学习/考公")!;
    act(() => target.dispatchEvent(dragEvent("dragover")));
    expect(target.getAttribute("data-drop-target"), "把父挂进自己的子标签居然显示可放").toBe(
      "invalid",
    );
    /* 非法目标不 preventDefault（要浏览器自己的禁止光标），所以真机上**收不到** drop：
       理由必须在悬停时就已经说出口，不能等一次不会发生的松手。 */
    expect(container.textContent, "悬停时没解释为什么不行").toContain("绕成环");

    await act(async () => {
      target.dispatchEvent(dragEvent("drop"));
    });

    expect(state.rename, "非法投放不该发意图").not.toHaveBeenCalled();
    const text = container.textContent ?? "";
    expect(text, "没有解释为什么不行").toContain("绕成环");
    expect(text, "把枚举名露给用户了").not.toContain("descendant");
  });

  it("指针还停在被拖的那一行上：既不说能放，也不报错", () => {
    const state = makeState();
    mount(state);

    const source = row("娱乐/燕云")!;
    act(() => source.dispatchEvent(dragEvent("dragstart")));
    expect(source.getAttribute("data-dragging"), "被拖的行没有标记").toBe("true");

    /* 拿起一行时指针必然先在自己的行上停留一下 —— 那不是"挂到自己下面"这种错误，
       标红或者说一句话都会让用户以为自己操作错了。 */
    act(() => source.dispatchEvent(dragEvent("dragover")));
    expect(source.getAttribute("data-drop-target"), "自己身上标了投放态").toBe("none");
    expect(container.textContent).not.toContain("不能挂到它自己下面");
  });

  /**
   * 根投放区也得**先判再画**：`学习/考公` 拖到根、而根上已经有 `考公` 时，
   * 那道虚线框不能先亮成"可以放"再在松手后报 `exists` —— 它在替一个放不下的
   * 动作打包票，与行上那套"判完才画"的结论也会自相矛盾。
   */
  it("根上已有同名标签时，根投放区不会先亮成可放", async () => {
    const state = makeState({
      tree: buildTagTree(
        ["娱乐", "娱乐/燕云", "学习/考公", "考公"].map((path) => ({ path, count: 1 })),
      ),
      paths: ["娱乐", "娱乐/燕云", "学习", "学习/考公", "考公"],
    });
    mount(state);

    act(() => row("学习/考公")!.dispatchEvent(dragEvent("dragstart")));
    const zone = container.querySelector<HTMLElement>('[aria-label="拖到这里移到一级标签"]')!;
    expect(zone, "拖拽中根投放区没出现").not.toBeNull();

    const over = dragEvent("dragover");
    act(() => zone.dispatchEvent(over));
    expect(zone.getAttribute("data-drop-target"), "放不下却亮了可放").not.toBe("ok");
    expect(
      over.defaultPrevented,
      "放不下却 preventDefault：浏览器会把它当成合法目标（松手才报错）",
    ).toBe(false);

    await act(async () => {
      zone.dispatchEvent(dragEvent("drop"));
    });
    expect(state.rename, "撞名不该发意图").not.toHaveBeenCalled();
    expect(container.textContent).toContain("已经存在");
  });

  it("搜索态下不给拖，并说明清空搜索后再拖", () => {
    mount(makeState());
    expect(row("学习/考公")!.draggable, "平时应当可拖").toBe(true);

    setInput(container.querySelector<HTMLInputElement>('input[aria-label="搜索标签"]')!, "考公");

    expect(row("学习/考公")!.draggable, "搜索态下仍然可拖").toBe(false);
    expect(container.textContent).toContain("清空搜索后再拖");
  });
});
