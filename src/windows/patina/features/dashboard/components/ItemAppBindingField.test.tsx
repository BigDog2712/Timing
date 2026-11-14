(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「绑定应用」一栏（[0.13 fix] 用户报「我启动了燕云，但未自动开始燕云事项计时」）。
 *
 * 判据钉的是**这一栏真的把绑定写到宿主能读到的地方**，而不是"下拉能点开"：
 *   ① 选中一个应用 → `saveAppItemBinding(exe, 当前事项)`（它内部再镜像宿主 `item_app`，
 *      镜像本身由 `services/appItemBindingMirror.test.ts` 钉住）——变异自证：把 `itemId` 换成常量
 *      或把写入口换成"只改本地 state"，ai02 立刻红；
 *   ② 解绑键发 `null`（清除 = 删行），不是发 0 / 空串；
 *   ③ 已绑定清单来自配置表的**两份真源并集**（1:1 ∪ override）：同一应用在别的事项上 →
 *      不出现在"已绑定"里；只在应用设置里绑过（override 型）的**必须**出现（ai05）
 *      —— 变异自证：退回"只读 1:1"，ai05 / ai06 红；
 *   ④ 候选里标出「已绑在『X』」——键空间是 1:1，选它等于把那条绑定挪过来（不标会让人
 *      以为"又多绑了一个"，回原事项却找不到）。
 */
interface UnionFixture {
  oneToOne: number | null;
  itemIds: number[];
  trackOff: boolean;
}

const union = (itemIds: number[], oneToOne: number | null = itemIds[0] ?? null): UnionFixture => ({
  oneToOne,
  itemIds,
  trackOff: false,
});

const h = vi.hoisted(() => ({
  loadAppItemBindingUnions: vi.fn(async (): Promise<Record<string, UnionFixture>> => ({})),
  mirrorItemBindingsOnce: vi.fn(async () => undefined),
  listAppItemBindingOptions: vi.fn(async (): Promise<{ id: number; name: string; color: string }[]> => []),
  saveAppItemBinding: vi.fn(async (_exeName: string, _itemId: number | null) => undefined),
  appCatalog: { candidates: [] as { exeName: string; appName: string }[], error: false },
}));

vi.mock("../services/appItemBindingMirror.ts", () => ({
  loadAppItemBindingUnions: h.loadAppItemBindingUnions,
  /* [0.13 fix] 存量绑定补镜像（毫秒级、无回执）：这一栏的判据不关心它，
     但少了这个导出 hook 会崩在 import 上 —— 它的行为由 `appItemBindingMirror.test.ts` 钉住。 */
  mirrorItemBindingsOnce: h.mirrorItemBindingsOnce,
}));

vi.mock("../services/appItemBinding.ts", () => ({
  listAppItemBindingOptions: h.listAppItemBindingOptions,
  saveAppItemBinding: h.saveAppItemBinding,
  /* 真实实现 = AppClassification.resolveStatisticalApp（trim + 小写 + 应用关联），
     这里原样复刻"同一归一只有一处"的口径，不引入第二个键空间 */
  resolveAppItemBindingExe: (exeName: string) => exeName.trim().toLowerCase(),
}));

vi.mock("../../classification/hooks/useClassificationAppCatalog.ts", () => ({
  useClassificationAppCatalog: () => ({
    candidates: h.appCatalog.candidates,
    loading: false,
    error: h.appCatalog.error,
  }),
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import ItemAppBindingField from "./ItemAppBindingField.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const field = () => document.body.querySelector<HTMLElement>(".qp-item-app-binding");
const boundRows = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>(".qp-item-app-binding .qp-timeline-edit-choice"))
    .map((node) => node.textContent?.trim() ?? "");
/** 下拉当前显示的 label（`QuietSelect` 把所有选项渲染进触发键，不能读 textContent） */
const currentLabel = () =>
  document.body.querySelector<HTMLElement>(".qp-item-app-binding-select .qp-select-label-current")
    ?.textContent?.trim() ?? "";
const menuOptions = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
const optionByText = (text: string) =>
  menuOptions().find((node) => node.textContent?.trim() === text) ?? null;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(itemId: number | null) {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(ItemAppBindingField, { itemId, enabled: true }),
    }));
  });
  await flush();
}

async function pickOption(label: string) {
  const trigger = document.body.querySelector<HTMLButtonElement>(".qp-item-app-binding-select .qp-select-trigger");
  if (!trigger) throw new Error("找不到应用下拉");
  await act(async () => { trigger.click(); });
  await flush();
  const option = optionByText(label);
  if (!option) throw new Error(`下拉里没有「${label}」：${menuOptions().map((n) => n.textContent).join("/")}`);
  await act(async () => { option.click(); });
  await flush();
}

beforeEach(() => {
  h.loadAppItemBindingUnions.mockReset();
  h.loadAppItemBindingUnions.mockResolvedValue({});
  h.mirrorItemBindingsOnce.mockClear();
  h.listAppItemBindingOptions.mockReset();
  h.listAppItemBindingOptions.mockResolvedValue([{ id: 3, name: "开会", color: "" }]);
  (h.saveAppItemBinding as Mock).mockClear();
  h.appCatalog = {
    candidates: [
      { exeName: "yanyun.exe", appName: "燕云十六声" },
      { exeName: "code.exe", appName: "VS Code" },
    ],
    error: false,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ItemAppBindingField", () => {
  it("ai01_选中一个应用就绑到当前事项_并显示为已绑定", async () => {
    await mount(3);
    expect(currentLabel()).toBe("选择一个应用");

    await pickOption("燕云十六声");

    /* 绑定路径第三个参数恒为 null（"要摘的那一条"只对解绑有意义，见 ai02） */
    expect(h.saveAppItemBinding).toHaveBeenCalledWith("yanyun.exe", 3, null);
    expect(boundRows().some((text) => text.includes("燕云十六声"))).toBe(true);
  });

  it("ai02_解绑发_null_而不是_0_或空串", async () => {
    h.loadAppItemBindingUnions.mockResolvedValue({ "yanyun.exe": union([3]) });
    await mount(3);

    const unbind = document.body.querySelector<HTMLButtonElement>(".qp-item-app-binding .qp-timeline-item-action");
    expect(unbind?.getAttribute("aria-label")).toBe("解绑 燕云十六声");
    await act(async () => { unbind?.click(); });
    await flush();

    expect(h.saveAppItemBinding, "解绑要带上「摘的是当前事项」这个 id（第三个参数）")
      .toHaveBeenCalledWith("yanyun.exe", null, 3);
    expect(boundRows().some((text) => text.includes("燕云十六声"))).toBe(false);
  });

  it("ai03_候选里标出已绑在别的事项_选它等于挪过来", async () => {
    h.loadAppItemBindingUnions.mockResolvedValue({ "code.exe": union([3]) });
    h.listAppItemBindingOptions.mockResolvedValue([
      { id: 3, name: "开会", color: "" },
      { id: 9, name: "写代码", color: "" },
    ]);
    h.appCatalog = {
      candidates: [
        { exeName: "code.exe", appName: "VS Code" },
        { exeName: "chrome.exe", appName: "Chrome" },
      ],
      error: false,
    };
    await mount(9);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(".qp-item-app-binding-select .qp-select-trigger")?.click();
    });
    await flush();

    const labels = menuOptions().map((node) => node.textContent?.trim());
    expect(labels).toContain("VS Code · 已绑在「开会」");
  });

  it("ai04_还没选事项时整栏不渲染", async () => {
    await mount(null);
    expect(field()).toBeNull();
  });

  /**
   * [第 6 条] 用户报的原话：「应用绑定事项唤起的事项结束后，事项未绑定到应用」——
   * 应用设置弹窗写的是 `__app_override::<exe>.itemBindings[]`，这一栏以前只读
   * `__app_item_binding::<exe>`，于是那种绑定**在界面上根本不存在**。
   * 变异自证：`bound` 的判据退回 `union.oneToOne === itemId` → 这条红（`boundRows()` 为空）。
   */
  it("ai05_只在应用设置里绑过（override 型）也要显示在已绑定清单", async () => {
    h.loadAppItemBindingUnions.mockResolvedValue({ "yanyun.exe": union([3], null) });
    await mount(3);

    expect(h.mirrorItemBindingsOnce, "读绑定时还会补一次存量镜像").toHaveBeenCalled();
    expect(boundRows().some((text) => text.includes("燕云十六声"))).toBe(true);
  });

  it("ai06_同一应用绑了多个事项_每个事项下都看得到它", async () => {
    /* 并集 [3, 9]：在事项 9 里也要看得到燕云（1:1 指向的是 3，只有并集视角认得 9） */
    h.loadAppItemBindingUnions.mockResolvedValue({ "yanyun.exe": union([3, 9], 3) });
    await mount(9);

    expect(boundRows().some((text) => text.includes("燕云十六声"))).toBe(true);
  });
});
