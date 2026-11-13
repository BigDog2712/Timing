(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../../../shared/AppErrorBoundary.tsx";
import { APP_BOUNDARY_COPY } from "./appBoundaryCopy.ts";
import outletSource from "./AppViewOutlet.tsx?raw";
import shellRootSource from "../AppShellLocaleRoot.tsx?raw";
import appSource from "../App.tsx?raw";

/**
 * [0.13 · 需求 1.2「无数据时全黑 + 无法返回」] 错误边界的判据（V-1.2a）。
 *
 * 根因是**结构性**的（不是样式）：分析窗此前完全没有错误边界，渲染期一抛异常，
 * React 19 会卸载整棵根树 → `#root` 变空 → 露出 WebView 深色底（「全黑」），
 * 标题栏与导航随树消失（「无法返回」）。
 *
 * 所以判据分两半，缺一半都不算修完：
 *   ① **边界真的在生效路径上**（渲染判据）：塞一个必抛的子组件，断言兜底面板出现、
 *      两颗键都在，且**同一棵树里的「导航」还在**（导航不在边界内 = 单页崩了还能换页）；
 *   ② **接线没被后来的人摘掉**（源码判据）：`AppViewOutlet` 里包着视图、
 *      `AppShellLocaleRoot` / `App.tsx` 各自还有一层。摘掉边界不会有任何报错，
 *      只会在下一次真崩的时候回到"全黑"—— 所以必须机械地钉住。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;
const COPY = APP_BOUNDARY_COPY["zh-CN"];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  /* 边界会把异常打进 console.error：测试里静音，免得把用例输出淹掉。
   * （React 仍然按正常路径走 getDerivedStateFromError / componentDidCatch。） */
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

function Boom(): ReactNode {
  throw new Error("boom-from-a-broken-card");
}

describe("V-1.2a 渲染期异常 → 兜底面板而不是空白", () => {
  it("v12a_fallback_renders_both_exits", () => {
    act(() => {
      root?.render(createElement(AppErrorBoundary, { copy: COPY, children: createElement(Boom) }));
    });
    const panel = container?.querySelector("[data-app-error-boundary]");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("alert");
    expect(container?.textContent ?? "").toContain(COPY.title);
    expect(container?.textContent ?? "").toContain(COPY.reload);
    /* 错误原文要露出来（否则用户只会说"它坏了"，谁也复现不了） */
    expect(container?.textContent ?? "").toContain("boom-from-a-broken-card");
  });

  it("v12a_back_home_key_only_shows_when_there_is_somewhere_to_go", () => {
    act(() => {
      root?.render(createElement(AppErrorBoundary, { copy: COPY, children: createElement(Boom) }));
    });
    expect(container?.textContent ?? "").not.toContain(COPY.backHome);
  });

  it("v12a_navigation_outside_the_boundary_survives_a_page_crash", () => {
    const onBackHome = vi.fn();
    /* 模拟 `AppShell` 的结构：标题栏 + 导航在边界**外面**，视图在边界里。 */
    act(() => {
      root?.render(createElement(
        "div",
        null,
        createElement("header", { "data-testid": "app-titlebar" }, "titlebar"),
        createElement("nav", { "data-testid": "app-topnav" }, "dashboard · history · data · settings"),
        createElement(AppErrorBoundary, { copy: COPY, onBackHome, children: createElement(Boom) }),
      ));
    });
    expect(container?.querySelector("[data-testid='app-titlebar']")).not.toBeNull();
    expect(container?.querySelector("[data-testid='app-topnav']")).not.toBeNull();
    expect(container?.querySelector("[data-app-error-boundary]")).not.toBeNull();

    const backHome = Array.from(container?.querySelectorAll("button") ?? [])
      .find((el) => el.textContent?.trim() === COPY.backHome);
    expect(backHome).toBeDefined();
    act(() => {
      backHome?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onBackHome).toHaveBeenCalledTimes(1);
  });
});

describe("V-1.2a 接线（摘掉边界等于什么都没修）", () => {
  it("v12a_outlet_wraps_the_view_and_keeps_the_title_bar_outside", () => {
    expect(outletSource).toContain("<AppErrorBoundary");
    /* key 绑在视图上：换页即重挂，错误态不会粘着上一个页面 */
    expect(outletSource).toContain("key={displayedView}");
    /* 边界只包 `views[displayedView]`，而 `<main>` 之外才是标题栏 —— 文档里
     * 「导航栏在边界外面」这条靠这个断言机械保证。 */
    const boundary = outletSource.indexOf("<AppErrorBoundary");
    const main = outletSource.indexOf("<main");
    expect(main).toBeGreaterThan(-1);
    expect(boundary).toBeGreaterThan(main);
    expect(outletSource).not.toContain("AppTitleBar");
  });

  it("v12a_shell_root_wraps_the_shell_with_a_locale_aware_copy", () => {
    expect(shellRootSource).toContain("<AppErrorBoundary");
    expect(shellRootSource).toContain("APP_BOUNDARY_COPY[locale]");
  });

  it("v12a_mini_window_gets_a_boundary_too", () => {
    expect(appSource).toContain("<AppErrorBoundary");
    expect(appSource).toContain("<MiniShell />");
  });

  it("v12a_boundary_copy_covers_all_four_locales", () => {
    for (const locale of ["zh-CN", "en-US", "ru-RU", "es"] as const) {
      const copy = APP_BOUNDARY_COPY[locale];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.reload.length).toBeGreaterThan(0);
      expect(copy.backHome.length).toBeGreaterThan(0);
    }
    expect(APP_BOUNDARY_COPY.es.title).not.toBe(APP_BOUNDARY_COPY["en-US"].title);
    expect(APP_BOUNDARY_COPY["ru-RU"].reload).not.toBe(APP_BOUNDARY_COPY["en-US"].reload);
  });
});
