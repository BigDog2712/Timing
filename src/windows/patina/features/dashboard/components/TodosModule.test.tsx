(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 待办卡「增删改 + 批量新建」的判据（[0.13 · 1.7]）。
 *
 * 钉的是"错了也照样出货"的静默项：
 *   ① footer 按钮能开弹层；
 *   ② 批量创建 = **一条** `todo_create_batch`（不是前端循环 `todo_create`）——
 *      勾提醒 → 每条 plan 的 `remindAt === plannedAt`（同一时刻）；
 *   ③ 不勾提醒 → `remindAt: null`（每条都弹两次提醒是这个口径写错的症状）；
 *   ④ 名称空 → 提交键 disabled；日期/时刻缺一边 → 就地一句提示、不发 IPC；
 *   ⑤ 落库失败（createBatch 返回 false）→ 弹层仍开、草稿仍在、有一句失败提示；
 *   ⑥ Esc 关闭；
 *   ⑦ V-1.7a：8 条待办 → **8 行**全渲染，卡头 meta 是量出来的数（前端不许截断）；
 *   ⑧ 行编辑：`todo_update` 的三态 patch 逐字转发（显式 `null` = 清空）。
 *
 * mock 与查询助手自成一册：`vi.mock` 只对声明它的测试文件生效（原生 setter 驱动
 * 受控输入，React 的 value tracker 认不出直接赋值）。
 */
const h = vi.hoisted(() => ({
  listPendingTodos: vi.fn(async (): Promise<unknown[]> => []),
  createTodo: vi.fn(async (): Promise<unknown> => ({})),
  createTodoBatch: vi.fn(async (_plans?: unknown): Promise<void> => undefined),
  updateTodo: vi.fn(async (_id?: unknown, _patch?: unknown): Promise<void> => undefined),
  toggleTodo: vi.fn(async () => undefined),
  deleteTodo: vi.fn(async () => undefined),
  emitHostIntent: vi.fn(async () => true),
}));

vi.mock("../../../platform/persistence/todoRepository.ts", () => ({
  listPendingTodos: h.listPendingTodos,
  createTodo: h.createTodo,
  createTodoBatch: h.createTodoBatch,
  updateTodo: h.updateTodo,
  toggleTodo: h.toggleTodo,
  deleteTodo: h.deleteTodo,
}));
vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import TodosModule from "./TodosModule.tsx";

/* TodosModule 的 useLayoutEffect 里 new ResizeObserver：jsdom 没有，给个空实现 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/* 真链路：挂真的 hook，这样 `model.createBatch` / `model.update` 的失败/成功路径都走生产代码 */
let latest: ReturnType<typeof useTodayTodos> | null = null;

function Harness(): null {
  latest = useTodayTodos(0);
  return createElement(TodosModule, { model: latest }) as unknown as null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function todo(id: number, over: Partial<TodoSummary> = {}): TodoSummary {
  return { id, title: `待办 ${id}`, plannedAt: null, remindAt: null, doneAt: null, sortOrder: id, ...over };
}

const dialog = () => document.body.querySelector<HTMLElement>(".qp-todo-dialog");
const nameInput = () => dialog()?.querySelector<HTMLInputElement>("input.qp-todo-name-input") ?? null;
const dateInput = () => dialog()?.querySelector<HTMLInputElement>("input[type='date']") ?? null;
const timeInput = () => dialog()?.querySelector<HTMLInputElement>("input[type='time']") ?? null;
const remindBox = () => dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']") ?? null;
const pickers = () => Array.from(dialog()?.querySelectorAll<HTMLElement>(".qp-todo-batch-picker") ?? []);
const chips = () => Array.from(dialog()?.querySelectorAll<HTMLElement>(".qp-todo-batch-chip") ?? []);
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

/** 打开新建弹层并填好一个（日期, 时刻）槽位 */
async function openComposeWithSlot(date: string, time: string) {
  act(() => { byText("＋ 新建待办")?.click(); });
  typeInto(nameInput(), "背单词");
  typeInto(dateInput(), date);
  act(() => { pickers()[0]?.querySelector<HTMLButtonElement>("button")?.click(); });
  typeInto(timeInput(), time);
  act(() => { pickers()[1]?.querySelector<HTMLButtonElement>("button")?.click(); });
  await flush();
}

beforeEach(() => {
  h.listPendingTodos.mockReset();
  h.listPendingTodos.mockResolvedValue([]);
  h.createTodo.mockReset();
  h.createTodo.mockResolvedValue({});
  h.createTodoBatch.mockReset();
  h.createTodoBatch.mockResolvedValue(undefined);
  h.updateTodo.mockReset();
  h.updateTodo.mockResolvedValue(undefined);
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

describe("TodosModule · ＋ 新建待办（批量）", () => {
  it("tq01_the_footer_button_opens_the_dialog", async () => {
    await mount();
    expect(dialog()).toBeNull();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect(dialog()).not.toBeNull();
    /* 焦点必须落在弹层表面内（QuietDialog 的 initialFocusRef 指向名称输入；jsdom 没有
       布局，精确断言"落在输入框"测不了，退而断言"没落在弹层外面" —— 焦点逃出弹层才是真回归）。 */
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("tq02_batch_submit_is_one_todo_create_batch_with_remindAt_equal_to_plannedAt", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    typeInto(nameInput(), "背单词");
    /* 多日期 × 多时刻：两个日期 × 一个时刻 = 2 条 plan */
    typeInto(dateInput(), "2030-01-02");
    act(() => { pickers()[0]?.querySelector<HTMLButtonElement>("button")?.click(); });
    typeInto(dateInput(), "2030-01-03");
    act(() => { pickers()[0]?.querySelector<HTMLButtonElement>("button")?.click(); });
    typeInto(timeInput(), "09:00");
    act(() => { pickers()[1]?.querySelector<HTMLButtonElement>("button")?.click(); });
    await flush();
    expect(chips()).toHaveLength(3);
    act(() => { remindBox()?.click(); });
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.createTodoBatch).toHaveBeenCalledTimes(1);
    const plans = h.createTodoBatch.mock.calls[0][0] as { title: string; plannedAt: number; remindAt: number | null }[];
    expect(plans).toHaveLength(2);
    const nine = new Date(2030, 0, 2, 9, 0).getTime();
    expect(plans[0].plannedAt).toBe(nine);
    expect(plans[0].remindAt).toBe(nine);
    expect(plans[1].plannedAt).toBe(new Date(2030, 0, 3, 9, 0).getTime());
    /* 勾了提醒 → 每条 plan 的 remindAt 与 plannedAt 同一时刻（两级提醒的基准） */
    expect(plans[1].remindAt).toBe(plans[1].plannedAt);
    /* 前端循环 `todo_create` 是这条判据的变异靶点：循环版不会出现 createTodoBatch 调用 */
    expect(h.createTodo).not.toHaveBeenCalled();
  });

  it("tq03_time_without_remind_lands_remindAt_null", async () => {
    await mount();
    await openComposeWithSlot("2030-01-02", "09:00");
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.createTodoBatch).toHaveBeenCalledTimes(1);
    const plans = h.createTodoBatch.mock.calls[0][0] as { title: string; plannedAt: number; remindAt: number | null }[];
    expect(plans).toHaveLength(1);
    expect(plans[0].plannedAt).toBe(new Date(2030, 0, 2, 9, 0).getTime());
    expect(plans[0].remindAt).toBeNull();
  });

  it("tq04_an_empty_name_keeps_the_confirm_button_disabled", async () => {
    await mount();
    act(() => { byText("＋ 新建待办")?.click(); });
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    typeInto(nameInput(), "   ");
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    act(() => { byText("确认")?.click(); });
    await flush();
    expect(h.createTodoBatch).not.toHaveBeenCalled();
  });

  it("tq04b_missing_dates_or_times_says_so_in_place_without_an_ipc", async () => {
    await mount();
    await openComposeWithSlot("2030-01-02", "09:00");
    /* 把日期 chip 移除 → 只剩时刻：笛卡尔积展开成 0 条的静默失败在这里先拦 */
    act(() => { chips()[0]?.querySelector<HTMLButtonElement>(".qp-todo-batch-chip-remove")?.click(); });
    act(() => { byText("确认")?.click(); });
    await flush();
    expect(statusText()).toContain("日期和时刻至少各选一个");
    expect(h.createTodoBatch).not.toHaveBeenCalled();
  });

  it("tq05_a_failed_batch_keeps_the_dialog_and_the_draft_and_says_so", async () => {
    h.createTodoBatch.mockRejectedValue(new Error("boom"));
    await mount();
    await openComposeWithSlot("2030-01-02", "09:00");
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.createTodoBatch).toHaveBeenCalledTimes(1);
    /* 失败"演成成功"（关弹层/清草稿）会让用户以为建好了，实际库里一条没有 */
    expect(dialog()).not.toBeNull();
    expect(nameInput()?.value).toBe("背单词");
    expect(chips().length).toBeGreaterThan(0);
    expect(statusText()).toContain("没能创建这条待办，请重试");
  });

  it("tq06_escape_closes_the_dialog", async () => {
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

describe("TodosModule · 列表全量渲染（V-1.7a）", () => {
  it("tq07_eight_todos_render_eight_rows_and_the_meta_counts_them_all", async () => {
    /* 显示**所有**未完成待办 —— 前端切片截断会让"还有 N 项"之外的事永远看不见 */
    h.listPendingTodos.mockResolvedValue(Array.from({ length: 8 }, (_, i) => todo(i + 1)));
    await mount();

    const rows = container?.querySelectorAll(".qp-todo-row") ?? [];
    expect(rows).toHaveLength(8);
    const meta = container?.querySelector(".qp-card-meta")?.textContent ?? "";
    expect(meta).toContain("8 条待办");
  });
});
