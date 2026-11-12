(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 待办卡「＋ 新建待办」弹层的判据（[本轮]，这张卡此前零直测）。
 *
 * 钉七件事：
 *   ① footer 按钮能开弹层；
 *   ② 名称 + 时间 + 勾提醒 → 落库载荷 = `(title, ms, ms)`（**同一个值**，时间口径钉死）；
 *   ③ 只填时间不勾提醒 → 第三参 `null`（每条待办都弹两次提醒是这个口径写错的症状）；
 *   ④ 名称空 → 提交键 disabled，且不发请求；
 *   ⑤ 时间清空 → 提醒勾选变 disabled（没时间就没有可提醒的时刻）；
 *   ⑥ 落库失败（create 返回 false）→ 弹层仍开、草稿仍在、有一句失败提示 ——
 *      失败"演成成功"会让用户以为建好了，实际库里没有；
 *   ⑦ Esc 关闭。
 *
 * mock 与查询助手自成一册：`vi.mock` 只对声明它的测试文件生效，与 `TimelineManage.test.tsx`
 * 同一套写法（原生 setter 驱动受控输入，React 的 value tracker 认不出直接赋值）。
 */
const h = vi.hoisted(() => ({
  listPendingTodos: vi.fn(async (): Promise<unknown[]> => []),
  createTodo: vi.fn(async (): Promise<unknown> => ({})),
  toggleTodo: vi.fn(async () => undefined),
  deleteTodo: vi.fn(async () => undefined),
  emitHostIntent: vi.fn(async () => true),
}));

vi.mock("../../../platform/persistence/todoRepository.ts", () => ({
  listPendingTodos: h.listPendingTodos,
  createTodo: h.createTodo,
  toggleTodo: h.toggleTodo,
  deleteTodo: h.deleteTodo,
}));
vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { parseDateTimeLocal } from "../services/todoDraft.ts";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import TodosModule from "./TodosModule.tsx";

/* TodosModule 的 useLayoutEffect 里 new ResizeObserver：jsdom 没有，给个空实现 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/* 真链路：挂真的 hook，这样 `model.create` 的失败/成功路径都走的是生产代码 */
let latest: ReturnType<typeof useTodayTodos> | null = null;

function Harness(): null {
  latest = useTodayTodos(0);
  return createElement(TodosModule, { model: latest }) as unknown as null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const dialog = () => document.body.querySelector<HTMLElement>(".qp-todo-dialog");
const nameInput = () => dialog()?.querySelector<HTMLInputElement>("input.qp-todo-name-input") ?? null;
const timeInput = () => dialog()?.querySelector<HTMLInputElement>("input[type='datetime-local']") ?? null;
const remindBox = () => dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']") ?? null;
const byText = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === text);
const statusText = () =>
  Array.from(dialog()?.querySelectorAll('[role="status"]') ?? [])
    .map((node) => node.textContent ?? "")
    .join(" | ");

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount() {
  await act(async () => {
    root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: createElement(Harness) }));
  });
  await flush();
}

/** 受控输入：必须走原生 setter，否则 React 的 value tracker 认不出变化 */
function typeInto(input: HTMLInputElement | null, value: string) {
  const target = input as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  h.listPendingTodos.mockReset();
  h.listPendingTodos.mockResolvedValue([]);
  h.createTodo.mockReset();
  h.createTodo.mockResolvedValue({});
  h.toggleTodo.mockReset();
  h.deleteTodo.mockReset();
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  latest = null;
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

describe("TodosModule · ＋ 新建待办", () => {
  it("tq01_the_footer_button_opens_the_dialog", async () => {
    await mount();
    expect(dialog()).toBeNull();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect(dialog()).not.toBeNull();
    /* 焦点必须落在弹层表面内（QuietDialog 的 initialFocusRef 指向名称输入；jsdom 没有
       布局，`getClientRects()` 恒空，精确断言"落在输入框"在这里测不了，退而断言
       "没落在弹层外面" —— 焦点逃出弹层才是真回归）。 */
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("tq02_name_plus_time_plus_remind_lands_the_same_moment_in_both_fields", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    typeInto(nameInput(), "看论文");
    typeInto(timeInput(), "2030-01-01T09:00");
    act(() => { remindBox()?.click(); });
    act(() => { byText("确认")?.click(); });
    await flush();

    const plannedAt = parseDateTimeLocal("2030-01-01T09:00");
    expect(h.createTodo).toHaveBeenCalledTimes(1);
    const args = h.createTodo.mock.calls[0] as unknown[];
    expect(args[0]).toBe("看论文");
    expect(args[1]).toBe(plannedAt);
    expect(args[2]).toBe(plannedAt);
  });

  it("tq03_time_without_remind_lands_remindAt_null", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    typeInto(nameInput(), "随手一条");
    typeInto(timeInput(), "2030-01-01T09:00");
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.createTodo).toHaveBeenCalledTimes(1);
    const args = h.createTodo.mock.calls[0] as unknown[];
    expect(args[1]).toBe(parseDateTimeLocal("2030-01-01T09:00"));
    expect(args[2]).toBeNull();
  });

  it("tq04_an_empty_name_keeps_the_confirm_button_disabled", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    typeInto(nameInput(), "   ");
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    act(() => { byText("确认")?.click(); });
    await flush();
    expect(h.createTodo).not.toHaveBeenCalled();
  });

  it("tq05_clearing_the_time_disables_the_remind_checkbox", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect(remindBox()?.disabled).toBe(true);
    typeInto(timeInput(), "2030-01-01T09:00");
    expect(remindBox()?.disabled).toBe(false);
    /* 清除时间 = 不排期，连带取消提醒 */
    act(() => { remindBox()?.click(); });
    expect(remindBox()?.checked).toBe(true);
    act(() => { byText("清除时间")?.click(); });
    expect(remindBox()?.disabled).toBe(true);
    /* [QA 补] 连带取消要真的取消勾选：只断言 disabled 钉不住 setRemind(false) */
    expect(remindBox()?.checked).toBe(false);
    expect(timeInput()?.value).toBe("");
  });

  it("tq06_a_failed_create_keeps_the_dialog_and_the_draft_and_says_so", async () => {
    h.createTodo.mockRejectedValue(new Error("boom"));
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    typeInto(nameInput(), "看论文");
    /* [QA 补] 失败要保住**三个**草稿：只断言名称的话，时间/勾选被清了测不出来 */
    typeInto(timeInput(), "2030-01-01T09:00");
    act(() => { remindBox()?.click(); });
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.createTodo).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(nameInput()?.value).toBe("看论文");
    expect(timeInput()?.value).toBe("2030-01-01T09:00");
    expect(remindBox()?.checked).toBe(true);
    expect(statusText()).toContain("没能创建这条待办，请重试");
  });

  it("tq07_escape_closes_the_dialog", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect(dialog()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    await flush();
    expect(dialog()).toBeNull();
  });
});
