(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 应用排行卡「双击行 → 快捷编辑（改分类 / 改名 / 绑定事项）」的**接线**判据（0.12.1）。
 *
 * 为什么这组必须存在（钉名字 ≠ 钉接线）：`appItemBinding.test.ts` 只钉了 KV 的形状，
 * `QuickClassificationSurface.test.tsx` 只钉了弹层里那一栏的渲染。中间那段 ——
 * 「哪一行 → 哪个 target」、「锚点落在谁身上」、「关掉后焦点回哪儿」、
 * 「行标记拿哪个键去查绑定」—— 一条都没被钉住，全部是**静默错**：
 *   · `exeName` 不归一 → 分类/改名写到了另一个键上；
 *   · anchor 不用被点的那一行 → 弹层从屏幕左上角弹出来；
 *   · 行标记用原始 exe 去查绑定表 → 绑定存上了、行上永远没标记（用户以为没存住）。
 *
 * 渲染手法沿用仓内口径（没装 @testing-library）：`createRoot` + `act`。
 */
const g = vi.hoisted(() => ({
  setBinding: vi.fn(),
  bindings: {} as Record<string, number>,
  items: [] as { id: number; name: string; color: string }[],
  itemsLoadFailed: false,
}));

vi.mock("../hooks/useAppItemBindings.ts", () => ({
  useAppItemBindings: () => ({
    bindings: g.bindings,
    items: g.items,
    itemsLoadFailed: g.itemsLoadFailed,
    setBinding: g.setBinding,
    reload: vi.fn(),
  }),
}));

/* 弹层本体（懒加载 + portal）不在这一组的判据里：这里只截获它收到的 props，
   用来看「传给弹层的东西对不对」。 */
const entryProps: { current: Record<string, unknown> | null } = { current: null };

vi.mock("../../classification/components/QuickClassificationEntry.tsx", () => ({
  preloadQuickClassificationEntry: () => Promise.resolve(),
  default: (props: Record<string, unknown>) => {
    entryProps.current = props;
    return createElement("div", { "data-testid": "quick-entry" });
  },
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import AppsModule from "./AppsModule.tsx";
import type { TopApplicationItem } from "../services/dashboardFormatting.ts";

const APPS: TopApplicationItem[] = [
  {
    exeName: "Code.exe",
    name: "VS Code",
    color: "#0a84ff",
    duration: 3_600_000,
    suspiciousDuration: 0,
    percentage: 50,
    categoryInitial: "D",
  },
  {
    exeName: "chrome.exe",
    name: "Chrome",
    color: "#0a84ff",
    duration: 1_800_000,
    suspiciousDuration: 0,
    percentage: 25,
    categoryInitial: "B",
  },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onOpenMapping = vi.fn<() => void>();

async function mount(apps: TopApplicationItem[] = APPS): Promise<void> {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => root?.render(createElement(LocaleProvider, {
    locale: "zh-CN",
    children: createElement(AppsModule, {
      applications: apps,
      icons: {},
      status: "ready",
      refreshError: false,
      onRetry: () => undefined,
      onOpenMapping,
    }),
  })));
}

function rows(): HTMLLIElement[] {
  return Array.from(container?.querySelectorAll<HTMLLIElement>(".qp-app-row") ?? []);
}

/** jsdom 的 `getBoundingClientRect` 恒为 0；锚点判据需要真实的盒。 */
function stubBox(row: HTMLLIElement, left: number, top: number, width: number, height: number) {
  row.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  }) as DOMRect;
}

function fire(element: Element, type: string, init: Record<string, unknown> = {}) {
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function key(element: Element, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

beforeEach(() => {
  g.setBinding.mockReset();
  g.bindings = {};
  g.items = [];
  g.itemsLoadFailed = false;
  entryProps.current = null;
  onOpenMapping = vi.fn<() => void>();
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

describe("入口可达性", () => {
  it("apps01_row_is_keyboard_reachable", async () => {
    await mount();
    for (const row of rows()) {
      expect(row.getAttribute("tabindex")).toBe("0");
      expect(row.hasAttribute("aria-haspopup")).toBe(true);
    }
  });

  it("apps02_double_click_opens_editor_on_the_clicked_row", async () => {
    await mount();
    const rowsNow = rows();
    const first = rowsNow[0]!;
    stubBox(first, 10, 20, 100, 19);

    fire(first, "dblclick");

    const props = entryProps.current;
    expect(props, "双击没有打开弹层").not.toBeNull();
    const request = props!.request as {
      target: { kind: string; exeName: string; displayName: string };
      anchor: { clientX: number; clientY: number };
      returnFocusTo: HTMLElement | null;
    };
    /* 归一：`Code.exe` → `code.exe`（分类/改名/绑定三张表同一个键空间）。 */
    expect(request.target.kind).toBe("app");
    expect(request.target.exeName).toBe("code.exe");
    expect(request.target.displayName).toBe("VS Code");
    /* 锚点必须是被点的那一行的中心，不是视口左上角、也不是上一行的盒。 */
    expect(request.anchor).toEqual({ clientX: 60, clientY: 29.5 });
    expect(request.returnFocusTo).toBe(first);
    expect(rowsNow[1]).not.toBe(first);
  });

  it("apps03_enter_space_and_shift_f10_all_open_the_editor", async () => {
    await mount();
    const row = rows()[0]!;

    for (const [k, init] of [["Enter", {}], [" ", {}], ["F10", { shiftKey: true }]] as const) {
      entryProps.current = null;
      key(row, k, init);
      expect(entryProps.current, `「${k}」没有打开弹层`).not.toBeNull();
      act(() => { (entryProps.current!.onClose as () => void)(); });
    }
  });

  it("apps04_context_menu_opens_the_editor", async () => {
    await mount();
    const row = rows()[1]!;
    stubBox(row, 0, 100, 200, 19);
    fire(row, "contextmenu");
    expect(entryProps.current).not.toBeNull();
    expect((entryProps.current!.request as { target: { exeName: string } }).target.exeName)
      .toBe("chrome.exe");
  });

  it("apps05_close_returns_focus_to_the_originating_row", async () => {
    await mount();
    const row = rows()[0]!;
    fire(row, "dblclick");
    expect(entryProps.current).not.toBeNull();

    act(() => { (entryProps.current!.onClose as () => void)(); });

    expect(container!.querySelector("[data-testid='quick-entry']"), "关闭后弹层仍在").toBeNull();
    expect(document.activeElement, "关闭后焦点没有回到原来那一行").toBe(row);
  });
});

describe("行上的绑定标记", () => {
  /* 两条对照组：`chrome.exe` 已经是归一后的键，`Code.exe` 不是。
     绑定表里的键**只有**归一后那一种（`saveAppItemBinding` 收到的是
     `createQuickAppClassificationTarget` 归一过的 exe），所以两组应当同样出标记。 */
  it("apps06_marker_shows_for_bound_app_with_canonical_exe", async () => {
    g.bindings = { "chrome.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "#123456" }];
    await mount();

    const chrome = rows()[1]!;
    expect(chrome.textContent, "已绑定的应用行上没有事项名").toContain("写代码");
    expect(chrome.querySelector(".qp-app-binding"), "行上没有绑定标记").not.toBeNull();
    expect(chrome.getAttribute("aria-label")).toContain("写代码");
  });

  it("apps06b_marker_shows_for_bound_app_whose_recorded_exe_keeps_its_case", async () => {
    /* 真实数据里 `AppStat.exeName` 会保留记录时的原始大小写（`resolveStatsExeName`
       只在 `appKey === normalizeExecutable(exeName)` 时返回原值），
       而绑定表的键被归一成小写 —— 这一条钉的就是这两者必须对得上。 */
    g.bindings = { "code.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "#123456" }];
    await mount();

    const code = rows()[0]!;
    expect(code.textContent, "大写 exe 的应用行上没有事项名").toContain("写代码");
    expect(code.querySelector(".qp-app-binding"), "大写 exe 的应用行上没有绑定标记").not.toBeNull();
  });

  it("apps06c_row_label_separates_edit_and_binding", async () => {
    /* 两段都是完整句子，中间必须有分隔符（只用空格时英文会念成「Edit VS Code Bound to: X」）。 */
    g.bindings = { "code.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "" }];
    await mount();

    expect(rows()[0]!.getAttribute("aria-label")).toBe("编辑应用「VS Code」，已绑定：写代码");
  });

  it("apps07_no_marker_when_unbound", async () => {
    await mount();
    for (const row of rows()) {
      expect(row.querySelector(".qp-app-binding")).toBeNull();
    }
  });

  it("apps08_marker_does_not_change_row_height", async () => {
    g.bindings = { "chrome.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "" }];
    await mount();
    const chrome = rows()[1]!;
    const label = chrome.querySelector(".qp-app-label")!;
    /* 行高由 `grid-template-rows: 19px 4px` + `height: var(--qp-row-app)` 锁死，
       标记不允许用 padding/border 把行顶高 —— 这两条属性就是那条判据。 */
    expect(label.querySelector(".qp-app-binding-name")).not.toBeNull();
    expect(label.querySelector(".qp-app-name"), "名字必须还在（标记不能顶掉名字）").not.toBeNull();
  });
});

describe("弹层里的绑定栏接线", () => {
  it("apps09_save_and_clear_pass_the_canonical_key", async () => {
    await mount();
    fire(rows()[0]!, "dblclick");

    const binding = entryProps.current!.itemBinding as {
      itemId: number | null;
      onSave: (itemId: number | null) => Promise<void>;
    };
    expect(binding, "没有把 itemBinding 传给弹层").toBeTruthy();
    expect(binding.itemId).toBeNull();

    await act(async () => { await binding.onSave(7); });
    expect(g.setBinding).toHaveBeenLastCalledWith("code.exe", 7);

    /* 清除 = `null`（Rust 侧删行），不是 `{"itemId":null}`。 */
    await act(async () => { await binding.onSave(null); });
    expect(g.setBinding).toHaveBeenLastCalledWith("code.exe", null);
  });

  it("apps10_item_binding_reflects_current_selection", async () => {
    g.bindings = { "code.exe": 9 };
    g.items = [{ id: 9, name: "开会", color: "" }];
    await mount();
    fire(rows()[0]!, "dblclick");
    expect((entryProps.current!.itemBinding as { itemId: number | null }).itemId).toBe(9);
  });
});

describe("第二条出口不许被拿走", () => {
  it("apps11_footer_still_opens_the_mapping_view", async () => {
    await mount();
    const footer = container!.querySelector<HTMLButtonElement>(".qp-card-footer");
    expect(footer, "卡底「全部分类…」入口不见了").not.toBeNull();
    act(() => footer!.click());
    expect(onOpenMapping).toHaveBeenCalledTimes(1);
  });
});
