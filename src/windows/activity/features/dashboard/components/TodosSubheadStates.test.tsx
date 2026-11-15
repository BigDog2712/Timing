(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [QA 补测] 待办卡「新建待办」那一行在**四态**里的存在性（`ModuleShell` 的 `subhead` 槽）。
 *
 * 已有用例只覆盖了 empty（tq08）与 ready（tq09）。槽位放错的典型症状恰好落在这两态之间：
 * 把 `subhead` 挪进 `children`（只在 ready 渲染）或挪进某个 `state === "ready"` 分支，
 * 已有两条仍然全绿 —— 但 loading / error 时就再也没有新建入口了，而"今天一条待办都没有、
 * 读取还失败了"正是最需要点它的时刻。
 *
 * loading 用**永不 resolve** 的 promise 造，error 用 reject 造，两态都不靠 mock 组件内部状态。
 */
const h = vi.hoisted(() => ({
  listPendingTodos: vi.fn(),
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
import TodosModule from "./TodosModule.tsx";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

function Harness(): null {
  const model = useTodayTodos(0);
  return createElement(TodosModule, { model }) as unknown as null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

async function mount(): Promise<void> {
  await act(async () => {
    root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: createElement(Harness) }));
  });
  await flush();
}

const entryRow = () => container?.querySelector<HTMLElement>(".at-todo-new-row") ?? null;
const entryButton = () =>
  Array.from(entryRow()?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((button) => (button.textContent ?? "").includes("新建待办")) ?? null;
const dialog = () => document.body.querySelector<HTMLElement>(".at-todo-dialog");

beforeEach(() => {
  h.listPendingTodos.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

describe("待办卡 · 新建入口在四态里都要在（subhead 不受 state 门控）", () => {
  it("ts01_loading_state_still_shows_the_entry_row", async () => {
    /* 永不 resolve：模块停在 loading 态 */
    h.listPendingTodos.mockImplementation(() => new Promise(() => {}));
    await mount();
    expect(container?.querySelector(".at-skeleton"), "没进 loading 态（夹具失效）").not.toBeNull();
    expect(entryRow(), "loading 态没有「新建待办」那一行").not.toBeNull();
    expect(entryButton(), "loading 态那一行里没有按钮").not.toBeNull();
  });

  it("ts02_error_state_still_shows_the_entry_row_and_it_opens_the_dialog", async () => {
    h.listPendingTodos.mockRejectedValue(new Error("ipc down"));
    await mount();
    expect(container?.querySelector(".at-skeleton"), "读取失败时不该停在骨架").toBeNull();
    expect(entryRow(), "error 态没有「新建待办」那一行").not.toBeNull();
    /* 弹层挂在 `ModuleShell` 外面：error 态点它必须能打开，否则入口是个死链 */
    act(() => { entryButton()?.click(); });
    await flush();
    expect(dialog(), "error 态点「新建待办」没有打开弹层").not.toBeNull();
  });

  it("ts03_empty_state_shows_the_row_and_no_overflow_readout", async () => {
    h.listPendingTodos.mockResolvedValue([]);
    await mount();
    expect(entryRow(), "空态没有「新建待办」那一行").not.toBeNull();
    expect(container?.querySelector(".at-todo-list"), "空态不该有列表").toBeNull();
    expect(container?.querySelector(".at-card-head-right .at-link-btn"), "入口又回到卡头右槽了").toBeNull();
  });
});
