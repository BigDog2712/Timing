/**
 * 「应用分类候选」面板的行为判据。
 *
 * 三条，各自对应一种「看起来对、算起来错」：
 *   1. 「首位」徽章只长在第一个 chip 上 —— 首位 = 规则 2 的兜底答案，标错了用户改顺序
 *      也不知道自己改了什么；
 *   2. 前移后写库的 priority 是**整组重排后**的值 —— 只写被移动那条会与邻居撞号，
 *      两条同 priority 时规则退化成按字典序，用户点一次上移、下次读出来又跳回去；
 *   3. 写入失败时界面回到库里的旧顺序，不保留乐观结果（顺序是会被切片当真的）。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../platform/persistence/attributionGateway.ts", () => ({
  listAppCategories: g.list,
  setAppCategory: g.set,
  removeAppCategory: g.remove,
}));

import SettingsAppCategoryPanel from "./SettingsAppCategoryPanel.tsx";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  g.list.mockReset();
  g.set.mockReset();
  g.remove.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(createElement(SettingsAppCategoryPanel, {}));
  });
}

function chips(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".settings-app-category-chip")];
}

describe("SettingsAppCategoryPanel", () => {
  it("首位徽章只出现在第一个分类上", async () => {
    g.list.mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "study", priority: 10 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 0 },
    ]);
    await render();

    const nodes = chips();
    expect(nodes.map((node) => node.textContent)).toEqual([
      expect.stringContaining("game"),
      expect.stringContaining("study"),
    ]);
    expect(nodes[0].hasAttribute("data-first")).toBe(true);
    expect(nodes[1].hasAttribute("data-first")).toBe(false);
    expect(nodes[0].textContent).toContain("首位");
    expect(nodes[1].textContent).not.toContain("首位");
  });

  it("前移把整组的 priority 重排后写入，而不是只写被移动的那条", async () => {
    /* 关键：`study` 本来在某位，前移后它与邻居交换。如果实现只写 `study` 的新 priority
       （或只写一条），另一条的旧号会与它撞上。 */
    g.list.mockResolvedValueOnce([
      { appKey: "chrome.exe", categoryKey: "game", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "study", priority: 10 },
    ]).mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "study", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 10 },
    ]);
    await render();

    const studyChip = chips()[1];
    const moveUp = studyChip.querySelector<HTMLButtonElement>('[aria-label^="前移"]');
    expect(moveUp).not.toBeNull();
    await act(async () => {
      moveUp!.click();
    });

    expect(g.set.mock.calls).toEqual([
      ["chrome.exe", "study", 0],
      ["chrome.exe", "game", 10],
    ]);
  });

  it("前移时只写 priority 真的变了的那条（未变的邻居不重复写）", async () => {
    /* 三个分类里移动末尾那条：`game` 的 priority 从 20 → 10，`study` 保持 0。
       若实现无差别整组重写，会对 `study` 发一次内容相同的写 —— 一次用户动作变成
       三条跨库写，且中间态可能被对端同步读到。 */
    g.list.mockResolvedValueOnce([
      { appKey: "chrome.exe", categoryKey: "study", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 10 },
      { appKey: "chrome.exe", categoryKey: "work", priority: 20 },
    ]).mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "study", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "work", priority: 10 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 20 },
    ]);
    await render();

    const workChip = chips()[2];
    await act(async () => {
      workChip.querySelector<HTMLButtonElement>('[aria-label^="前移"]')!.click();
    });

    /* 交换的是 10 与 20 这两条，0 那条不动。 */
    expect(g.set.mock.calls).toEqual([
      ["chrome.exe", "work", 10],
      ["chrome.exe", "game", 20],
    ]);
  });

  it("已在首位时前移按钮禁用（不是「可点但没反应」）", async () => {
    g.list.mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "study", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 10 },
    ]);
    await render();
    const moveUp = chips()[0].querySelector<HTMLButtonElement>('[aria-label^="前移"]');
    expect(moveUp?.disabled).toBe(true);
  });
});
