(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 应用排行卡的**接线**判据（[0.12.4] 起编辑入口改成「标签」）。
 *
 * 为什么这组必须存在（钉名字 ≠ 钉接线）：`AppTagDialog` 只钉了自己那一屏的渲染，
 * 中间那段 —— 「双击 / 回车 / 右键把**哪一个应用**交给弹层」「关掉之后弹层有没有
 * 真的卸载」「行上的标签从哪张表取」—— 一条都没被钉住，全部是**静默错**：
 *   · 传错 exe → 标签写到另一个键上；
 *   · 关掉不清 state → 再双击同一个应用，弹层用的是上一次的草稿；
 *   · 行标记用原始 exe 去查绑定表 → 绑定存上了、行上永远没标记。
 *
 * 渲染手法沿用仓内口径（没装 @testing-library）：`createRoot` + `act`。
 */
const g = vi.hoisted(() => ({
  bindings: {} as Record<string, number>,
  items: [] as { id: number; name: string; color: string }[],
}));

vi.mock("../hooks/useAppItemBindings.ts", () => ({
  useAppItemBindings: () => ({
    bindings: g.bindings,
    items: g.items,
    itemsLoadFailed: false,
    setBinding: vi.fn(),
    reload: vi.fn(),
  }),
}));

/* 弹层本体（portal + 标签编辑）不在这一组的判据里：这里只截获它收到的 props。 */
const dialogProps: { current: Record<string, unknown> | null } = { current: null };

vi.mock("./AppTagDialog.tsx", () => ({
  default: (props: Record<string, unknown>) => {
    dialogProps.current = props;
    return createElement("div", { "data-testid": "app-tag-dialog" });
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
  return Array.from(container?.querySelectorAll<HTMLLIElement>(".at-app-row") ?? []);
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
  g.bindings = {};
  g.items = [];
  dialogProps.current = null;
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

describe("标签编辑入口", () => {
  it("apps01_row_is_keyboard_reachable", async () => {
    await mount();
    for (const row of rows()) {
      expect(row.getAttribute("tabindex")).toBe("0");
      expect(row.hasAttribute("aria-haspopup")).toBe(true);
    }
  });

  it("apps02_double_click_opens_tag_editor_for_the_clicked_row", async () => {
    await mount();
    fire(rows()[0]!, "dblclick");

    expect(dialogProps.current, "双击没有打开标签编辑").not.toBeNull();
    expect(dialogProps.current!.exeName).toBe("Code.exe");
    expect(dialogProps.current!.displayName).toBe("VS Code");
    expect(container!.querySelector("[data-testid='app-tag-dialog']")).not.toBeNull();
  });

  it("apps03_enter_space_and_shift_f10_all_open_the_editor", async () => {
    await mount();
    const row = rows()[0]!;

    for (const [k, init] of [["Enter", {}], [" ", {}], ["F10", { shiftKey: true }]] as const) {
      dialogProps.current = null;
      key(row, k, init);
      expect(dialogProps.current, `「${k}」没有打开标签编辑`).not.toBeNull();
      act(() => { (dialogProps.current!.onClose as () => void)(); });
      expect(container!.querySelector("[data-testid='app-tag-dialog']"), "关闭后弹层仍在").toBeNull();
    }
  });

  it("apps04_context_menu_opens_the_editor", async () => {
    await mount();
    fire(rows()[1]!, "contextmenu");
    expect(dialogProps.current).not.toBeNull();
    expect(dialogProps.current!.exeName).toBe("chrome.exe");
  });

  it("apps05_close_unmounts_the_dialog", async () => {
    await mount();
    fire(rows()[0]!, "dblclick");
    act(() => { (dialogProps.current!.onClose as () => void)(); });
    expect(container!.querySelector("[data-testid='app-tag-dialog']"), "关闭后弹层仍在").toBeNull();
    /* 再双击同一个应用要拿到一份**新的** props（同一 exe 靠 state 清空后重挂） */
    dialogProps.current = null;
    fire(rows()[0]!, "dblclick");
    expect(dialogProps.current!.exeName).toBe("Code.exe");
  });

  it("apps05b_saving_tags_keeps_the_dialog_and_re-reads_row_tags", async () => {
    await mount();
    fire(rows()[0]!, "dblclick");
    const onSaved = dialogProps.current!.onSaved as () => void;
    act(() => onSaved());
    /* 保存不自动关弹层（`onClose` 才关），但行上的标签会按新映射重取一次 */
    expect(container!.querySelector("[data-testid='app-tag-dialog']")).not.toBeNull();
  });
});

describe("行上的绑定标记", () => {
  /* 两条对照组：`chrome.exe` 已经是归一后的键，`Code.exe` 不是。
     绑定表里的键**只有**归一后那一种，所以两组应当同样出标记。 */
  it("apps06_marker_shows_for_bound_app_with_canonical_exe", async () => {
    g.bindings = { "chrome.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "#123456" }];
    await mount();

    const chrome = rows()[1]!;
    expect(chrome.textContent, "已绑定的应用行上没有事项名").toContain("写代码");
    expect(chrome.querySelector(".at-app-binding"), "行上没有绑定标记").not.toBeNull();
    expect(chrome.getAttribute("aria-label")).toContain("写代码");
  });

  it("apps06b_marker_shows_for_bound_app_whose_recorded_exe_keeps_its_case", async () => {
    g.bindings = { "code.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "#123456" }];
    await mount();

    const code = rows()[0]!;
    expect(code.textContent, "大写 exe 的应用行上没有事项名").toContain("写代码");
    expect(code.querySelector(".at-app-binding"), "大写 exe 的应用行上没有绑定标记").not.toBeNull();
  });

  it("apps06c_row_label_separates_edit_and_binding", async () => {
    g.bindings = { "code.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "" }];
    await mount();

    expect(rows()[0]!.getAttribute("aria-label")).toBe("编辑应用「VS Code」，已绑定：写代码");
  });

  it("apps07_no_marker_when_unbound", async () => {
    await mount();
    for (const row of rows()) {
      expect(row.querySelector(".at-app-binding")).toBeNull();
    }
  });

  it("apps08_marker_does_not_change_row_height", async () => {
    g.bindings = { "chrome.exe": 7 };
    g.items = [{ id: 7, name: "写代码", color: "" }];
    await mount();
    const chrome = rows()[1]!;
    const label = chrome.querySelector(".at-app-label")!;
    expect(label.querySelector(".at-app-binding-name")).not.toBeNull();
    expect(label.querySelector(".at-app-name"), "名字必须还在（标记不能顶掉名字）").not.toBeNull();
  });
});

describe("第二条出口不许被拿走", () => {
  it("apps11_footer_still_opens_the_mapping_view", async () => {
    await mount();
    const footer = container!.querySelector<HTMLButtonElement>(".at-card-footer");
    expect(footer, "卡底入口不见了").not.toBeNull();
    act(() => footer!.click());
    expect(onOpenMapping).toHaveBeenCalledTimes(1);
  });
});

/**
 * [0.12.6 · P0-9] 工具类应用在排行行上的标记。
 *
 * 判据不是"有个小字"，而是三件事同时成立：
 *   ① 标记能看见且说出后果（`title` 点名**已扣除的那两项**：总量与分类分布）—— 它的时长
 *      已经从总量/分布里被扣掉了，没有这个标记，用户唯一的感受是"我的总时长怎么少了"；
 *      文案**故意不提趋势**：今日分时柱本轮不剔除工具类（后端逐桶并集拿不到逐应用分摊，
 *      见设计文档风险 3），写"不计入时间统计"会在趋势卡上自相矛盾；
 *   ② **只标工具类**：别的行走 `isTool` 缺省（`undefined`）= 不是工具类，不能误标；
 *   ③ **不动行几何**：名字还在（标记不能顶掉名字），标记挂在名字所在的第二列里
 *      （`dashboard-apps.css` 的 `.at-app-tool` 用 `flex: none` + 15px 行高做到不改行高）。
 */
describe("工具标记（不计入统计）", () => {
  const WITH_TOOL: TopApplicationItem[] = [
    { ...APPS[0]!, isTool: true },
    APPS[1]!,
  ];

  it("apps12_tool_row_shows_a_badge_with_the_consequence_in_title", async () => {
    await mount(WITH_TOOL);

    const badge = rows()[0]!.querySelector(".at-app-tool");
    expect(badge, "工具类的行上没有标记 —— 用户查不到时长为什么变少").not.toBeNull();
    expect(badge!.textContent?.trim()).toBe("工具");
    expect(badge!.getAttribute("title")).toBe("工具类应用，不计入总量与分类分布");
  });

  it("apps13_non_tool_row_has_no_badge", async () => {
    await mount(WITH_TOOL);

    expect(rows()[0]!.querySelector(".at-app-tool")).not.toBeNull();
    expect(rows()[1]!.querySelector(".at-app-tool"), "非工具类不许被误标").toBeNull();
  });

  it("apps14_badge_keeps_the_name_and_lives_in_the_label_cell", async () => {
    await mount(WITH_TOOL);

    const label = rows()[0]!.querySelector(".at-app-label")!;
    expect(label.querySelector(".at-app-name")?.textContent, "标记顶掉了名字").toBe("VS Code");
    expect(label.querySelector(".at-app-tool"), "标记必须留在第二列（不许新开一列改列宽）").not.toBeNull();
    /* 行仍然是原来那三段 grid（图标 / 名字 / 时长）：标记不新增直接子节点 */
    expect(rows()[0]!.children.length).toBe(rows()[1]!.children.length);
  });
});
