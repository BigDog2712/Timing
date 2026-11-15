(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 待办卡「还有 K 项」的**量测回归**（[QA 本轮独立复核]）。
 *
 * 入口搬过两次家：卡底 `footer` → 卡头 `headAction` → 卡头下方一条 24 高的通栏窄行
 * （[本轮]）。每一次卡片可用高度都会变（本轮少 28px）。`TodosModule` 的注释主张
 * "可见行数是从 `offsetTop` 差量出来的，所以一个数字都不用改"——这条主张必须被**量测**
 * 验证，而不是被注释说服：
 *
 *   visible = floor((clientHeight − rowH) / pitch) + 1
 *   hidden  = rows.length − visible
 *
 * 所以判据是：固定行高 / 行距，**只改列表的 clientHeight**（= 入口搬家带来的那点高度差），
 * 看 `还有 K 项` 是否跟着正确变化；同时覆盖空态 / 1 条 / 超屏三种边界。
 * jsdom 没有排版，`offsetHeight`/`clientHeight` 一律 0，只能在挂载后钉住再派发一次
 * `scroll` 让 `syncTodoDerived()` 重算（生产代码里 RO 与 scroll 都调用它）。
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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

let latest: ReturnType<typeof useTodayTodos> | null = null;

function Harness(): null {
  latest = useTodayTodos(0);
  return createElement(TodosModule, { model: latest }) as unknown as null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const ROW_HEIGHT = 44;
const PITCH = 44;

function todo(id: number): TodoSummary {
  return { id, title: `待办 ${id}`, plannedAt: null, remindAt: null, doneAt: null, sortOrder: id };
}

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

const list = () => container?.querySelector<HTMLElement>(".at-todo-list") ?? null;
const metaText = () => container?.querySelector(".at-card-meta")?.textContent ?? "";
const entry = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
  .find((button) => button.textContent === "新建待办");

/** 钉住列表高度与每行的几何，然后派发一次 scroll 让 `syncTodoDerived()` 重算 */
function layout(listHeight: number) {
  const ul = list();
  if (!ul) return;
  Object.defineProperty(ul, "clientHeight", { configurable: true, value: listHeight });
  Object.defineProperty(ul, "scrollHeight", { configurable: true, value: listHeight });
  Array.from(ul.children).forEach((child, index) => {
    Object.defineProperty(child, "offsetHeight", { configurable: true, value: ROW_HEIGHT });
    Object.defineProperty(child, "offsetTop", { configurable: true, value: index * PITCH });
  });
  act(() => { ul.dispatchEvent(new Event("scroll")); });
}

beforeEach(() => {
  h.listPendingTodos.mockReset();
  h.listPendingTodos.mockResolvedValue([]);
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

describe("待办卡 · 入口在卡头之下时的「还有 K 项」", () => {
  it("tl01_the_empty_state_has_the_entry_and_no_overflow_readout", async () => {
    await mount();
    /* 空态：入口在（这是入口一路搬家的全部理由） */
    expect(entry()).not.toBeUndefined();
    expect(entry()?.closest(".at-todo-new-row"), "入口在卡头下方那条窄行里").not.toBeNull();
    /* 空态没有列表、也没有 meta 读数 */
    expect(list()).toBeNull();
    expect(metaText()).toBe("");
  });

  it("tl02_a_single_row_fits_and_never_says_more", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();
    layout(176);
    expect(container?.querySelectorAll(".at-todo-row")).toHaveLength(1);
    expect(metaText()).toBe("1 条待办");
    expect(metaText()).not.toContain("还有");
  });

  it("tl03_eight_rows_in_a_four_row_viewport_report_the_four_hidden_ones", async () => {
    h.listPendingTodos.mockResolvedValue(Array.from({ length: 8 }, (_, i) => todo(i + 1)));
    await mount();
    /* 176 = 4 行 × 44：visible = floor((176−44)/44)+1 = 4 → hidden = 8 − 4 = 4 */
    layout(176);
    expect(metaText()).toBe("8 条待办还有 4 项 ▸");
  });

  it("tl04_the_hidden_count_follows_the_measured_height_not_a_constant", async () => {
    h.listPendingTodos.mockResolvedValue(Array.from({ length: 8 }, (_, i) => todo(i + 1)));
    await mount();
    /* 入口搬家带来的正是"列表更高"这回事：264 = 6 行 → visible = 6 → hidden = 2 */
    layout(264);
    expect(metaText()).toBe("8 条待办还有 2 项 ▸");
    /* 再压回两行高 → hidden 跟着变 6（没有人把 4 写死成常量） */
    layout(88);
    expect(metaText()).toBe("8 条待办还有 6 项 ▸");
  });

  it("tl05_a_collapsed_list_reports_every_row_as_hidden_instead_of_a_negative_or_zero_gap", async () => {
    h.listPendingTodos.mockResolvedValue(Array.from({ length: 3 }, (_, i) => todo(i + 1)));
    await mount();
    /* 高度为 0（卡被折叠 / 极窄档位）：visible 会算成 0，hidden 必须是 3 而不是负数 */
    layout(0);
    expect(metaText()).toBe("3 条待办还有 3 项 ▸");
  });
});
