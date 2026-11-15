/**
 * [本轮 T05] 顶栏两条判据：
 *   · V-3b（居中，源码级）：`.app-titlebar` 必须是三栏 grid（`minmax(0,1fr) auto
 *     minmax(0,1fr)`），左右两栏等宽才可能让 tab 段落在窗口正中；`.qp-topbar-nav`
 *     不得恢复 flex 顺序排布（无对称吸收就没有居中）。段宽锁死：brand 用
 *     `--qp-brand-w`、controls 用 `--qp-controls-w`，两个变量不许被绕开。
 *   · V-3c（拖窗，运行时）：`isInteractive` 判据 —— topbar 空白处 pointerdown 触发
 *     `startDragging`；tab / 窗口控件 / `[data-no-drag]` 上 pointerdown 不触发。
 *     jsdom 没有布局引擎，居中量不出像素，几何用源码判据钉；手势行为用真渲染钉。
 *     （本仓暂不引入 RTL：渲染走 `react-dom/client` + `act`，与既有组件测试同法。）
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from "node:path";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from "node:url";

const patinaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startCurrentWindowDrag = vi.fn(() => Promise.resolve());

vi.mock("../../platform/desktop/windowControlGateway.ts", () => ({
  startCurrentWindowDrag: () => startCurrentWindowDrag(),
  minimizeCurrentWindow: () => Promise.resolve(),
  toggleCurrentWindowMaximized: () => Promise.resolve(),
  closeCurrentWindow: () => Promise.resolve(),
  showMainWindow: () => Promise.resolve(),
}));

vi.mock("../../platform/desktop/miniWindowRuntimeGateway.ts", () => ({
  openMiniWindow: () => Promise.resolve(),
}));

import AppTitleBar from "./AppTitleBar.tsx";
import { LocaleProvider } from "../../shared/i18n/LocaleContext.tsx";
import { createElement } from "react";

function read(rel: string): string {
  return readFileSync(join(patinaRoot, rel), "utf8");
}

describe("[T05] V-3b · 顶栏居中（源码级）", () => {
  const topbar = read("shell/styles/topbar.css");

  test(".app-titlebar 是 1fr auto 1fr 的三栏 grid（改回 flex 顺序排布即红）", () => {
    expect(topbar).toMatch(/\.app-titlebar\s*\{[^}]*display:\s*grid/);
    expect(topbar).toMatch(/\.app-titlebar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
  });

  test("段宽变量未被绕开：brand 用 --qp-brand-w、controls 用 --qp-controls-w", () => {
    expect(topbar).toMatch(/\.app-titlebar-brand\s*\{[^}]*var\(--qp-brand-w\)/);
    expect(topbar).toMatch(/\.app-titlebar-controls\s*\{[^}]*var\(--qp-controls-w\)/);
  });

  test("左右两栏等宽：.app-titlebar-side 不再 flex-grow（吸收由 grid 均分完成）", () => {
    expect(topbar).toMatch(/\.app-titlebar-side\s*\{/);
    expect(topbar).not.toMatch(/\.app-titlebar-side\s*\{[^}]*flex:\s*1/);
  });
});

describe("[T05] V-3c · 拖窗判据 isInteractive（运行时）", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(LocaleProvider, {
          locale: "zh-CN",
          children: createElement(AppTitleBar, {
            isMaximized: false,
            timingStatusEntry: null,
            navigationSlot: createElement(
              "nav",
              { className: "qp-topbar-nav", "data-topbar-nav": "" },
              createElement("button", { type: "button", className: "qp-topbar-tab" }, "tab"),
            ),
          }),
          }),
        );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** pointerdown + 越过 4px 阈值的 pointermove + pointerup（拖动手势的完整三拍） */
  const drag = (target: Element) => {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true, button: 0, screenX: 10, screenY: 10,
      }));
      window.dispatchEvent(new MouseEvent("pointermove", { screenX: 60, screenY: 40 }));
      window.dispatchEvent(new MouseEvent("pointerup", {}));
    });
  };

  beforeEach(() => {
    startCurrentWindowDrag.mockClear();
  });

  test("topbar 空白处 pointerdown + 移动 → startDragging 恰好一次", () => {
    drag(container.querySelector(".app-titlebar") as HTMLElement);
    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
  });

  test("tab 上 pointerdown + 移动 → 不拖窗（变异③：isInteractive 短路必红）", () => {
    drag(container.querySelector(".qp-topbar-tab") as HTMLElement);
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });

  test("窗口控件上 pointerdown → 不拖窗", () => {
    drag(container.querySelector(".app-titlebar-close") as HTMLElement);
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });

  test("[data-no-drag] 子树 pointerdown → 不拖窗", () => {
    const bar = container.querySelector(".app-titlebar") as HTMLElement;
    const zone = document.createElement("div");
    zone.setAttribute("data-no-drag", "");
    bar.appendChild(zone);
    drag(zone);
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });
});
