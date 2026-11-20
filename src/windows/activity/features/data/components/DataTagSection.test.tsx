import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 数据页标签面（[2026-11-20]）：应用标签弹窗保存后，标签管理区的树必须当场重读。
 *
 * 弹窗保存时会给新标签补定义行；标签管理的数据在 `useTagAdmin` 自己的 state 里，
 * 不重读的话用户在弹窗里新建的标签要等整页重挂才出现 —— 这就是
 * 「应用趋势 / 应用排行里绑的标签，标签管理处看不到」的另一半原因。
 */
const g = vi.hoisted(() => ({ reload: vi.fn(async () => undefined) }));

vi.mock("../hooks/useTagAdmin.ts", () => ({
  useTagAdmin: () => ({
    tree: [],
    paths: [],
    counts: {},
    loading: false,
    error: null,
    reload: g.reload,
    create: async () => [],
    rename: async () => undefined,
    remove: async () => undefined,
  }),
}));

vi.mock("../../dashboard/components/AppTagDialog.tsx", () => ({
  default: (props: { onSaved?: () => void }) => (
    <button type="button" onClick={props.onSaved}>save-tag</button>
  ),
}));

vi.mock("./DataTagManagerPanel.tsx", () => ({ default: () => null }));

import DataTagSection from "./DataTagSection.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  g.reload = vi.fn(async () => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("数据页标签面", () => {
  it("dt01_saving_app_tags_reloads_the_tag_tree_and_notifies_the_page", async () => {
    const onSaved = vi.fn();
    await act(async () => {
      root.render(createElement(DataTagSection, {
        target: { exeName: "chrome.exe", name: "Google Chrome" },
        onClose: () => undefined,
        onSaved,
        onError: () => undefined,
      }));
    });
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "save-tag");
    await act(async () => { save?.click(); });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(g.reload).toHaveBeenCalledTimes(1);
  });
});
