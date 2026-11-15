(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `useTodayTodos().create` 三参链路的判据（[本轮]）。
 *
 * 弹层把 `(title, plannedAt, remindAt)` 交给 hook，hook 传给 `todoRepository.createTodo`
 * —— 这一环要是吞了参数（还按旧的一参签名调），用户填的时间/提醒就**静默丢失**：
 * 界面不报错、库里的行两列都是 null。所以三条都要钉：
 *   ① 三参原样落到 `createTodo`（含 `null`）；
 *   ② `createTodo` 抛错 → 返回 false、列表不动（直接 IPC 没有 `sent` 布尔，
 *      失败就是抛错 → catch → false，不许伪装成成功）；
 *   ③ 成功 → `listPendingTodos` 再被调一次（reload），返回 true。
 */
const h = vi.hoisted(() => ({
  listPendingTodos: vi.fn(async (): Promise<unknown[]> => []),
  createTodo: vi.fn(async (): Promise<unknown> => ({})),
  createTodoBatch: vi.fn(async (_plans?: unknown): Promise<void> => undefined),
  updateTodo: vi.fn(async (_id?: unknown, _patch?: unknown): Promise<void> => undefined),
  toggleTodo: vi.fn(async () => undefined),
  deleteTodo: vi.fn(async () => undefined),
}));

vi.mock("../../../platform/persistence/todoRepository.ts", () => ({
  listPendingTodos: h.listPendingTodos,
  createTodo: h.createTodo,
  createTodoBatch: h.createTodoBatch,
  updateTodo: h.updateTodo,
  toggleTodo: h.toggleTodo,
  deleteTodo: h.deleteTodo,
}));

import { useTodayTodos, type TodayTodosState } from "./useTodayTodos.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";

function todo(id: number, over: Partial<TodoSummary> = {}): TodoSummary {
  return { id, title: `待办 ${id}`, plannedAt: null, remindAt: null, doneAt: null, sortOrder: id, ...over };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: TodayTodosState | null = null;

function Probe(): null {
  latest = useTodayTodos(0);
  return null;
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(): Promise<void> {
  await act(async () => { root?.render(createElement(Probe)); });
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

describe("useTodayTodos · create 的三参链路", () => {
  it("tn01_forwards_title_plannedAt_remindVerbatim_to_the_repository", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();

    const plannedAt = new Date(2030, 0, 1, 9, 0).getTime();
    let accepted = true;
    await act(async () => {
      accepted = await latest!.create("看论文", plannedAt, plannedAt);
    });
    await flush();

    expect(accepted).toBe(true);
    expect(h.createTodo).toHaveBeenCalledTimes(1);
    expect(h.createTodo).toHaveBeenCalledWith("看论文", plannedAt, plannedAt);
  });

  it("tn02_null_remind_at_is_forwarded_as_null_not_dropped", async () => {
    await mount();
    let accepted = true;
    await act(async () => {
      accepted = await latest!.create("随手一条", null, null);
    });
    await flush();
    expect(accepted).toBe(true);
    expect(h.createTodo).toHaveBeenCalledWith("随手一条", null, null);
  });

  it("tn03_a_rejected_create_returns_false_and_leaves_the_list_untouched", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();
    h.createTodo.mockRejectedValue(new Error("boom"));

    let accepted = true;
    await act(async () => {
      accepted = await latest!.create("看论文", null, null);
    });
    await flush();

    expect(accepted).toBe(false);
    /* 列表不能被失败波及：旧行原样保留（reload 是 await 在 catch 之后才不走的） */
    expect(latest!.todos.map((row) => row.id)).toEqual([1]);
    expect(latest!.status).toBe("ready");
  });

  it("tn04_a_successful_create_reloads_the_list", async () => {
    h.listPendingTodos.mockResolvedValue([]);
    await mount();
    expect(h.listPendingTodos).toHaveBeenCalledTimes(1);

    h.listPendingTodos.mockResolvedValue([todo(7)]);
    let accepted = false;
    await act(async () => {
      accepted = await latest!.create("看论文", null, null);
    });
    await flush();

    expect(accepted).toBe(true);
    expect(h.listPendingTodos).toHaveBeenCalledTimes(2);
    expect(latest!.todos.map((row) => row.id)).toEqual([7]);
    expect(latest!.status).toBe("ready");
  });

  it("tn05_an_empty_title_returns_false_without_touching_the_ipc", async () => {
    await mount();
    let accepted = true;
    await act(async () => {
      accepted = await latest!.create("   ", null, null);
    });
    expect(accepted).toBe(false);
    expect(h.createTodo).not.toHaveBeenCalled();
  });
});

/**
 * [0.13 · 1.7] 批量创建与单条编辑的判据。
 *
 * `createBatch` 是本轮唯一的**新命令** `todo_create_batch` 的前端唯一入口：
 *   · plans 必须逐字转发（hook 不展开、不去重、不改 remind 语义 —— 口径在
 *     `expandTodoBatch` 一处）；
 *   · 失败（IPC 抛错）→ false，列表不动 —— 失败"演成成功"会让弹层关掉、草稿清掉，
 *     用户以为建好了，实际库里一条都没有；
 *   · 空 plans 直接 false 且**不发 IPC**（后端 1..=60 拒空批，没必要过网络）。
 *
 * `update` 走既有 `todo_update`：patch 三态逐字转发（显式 `null` = 清空，
 * Rust `TodoPatch` 的 double_option 靠它区分"没给"和"清空"）。
 */
describe("useTodayTodos · createBatch 与 update", () => {
  it("tb01_forwards_plans_verbatim_to_createTodoBatch_and_reloads", async () => {
    await mount();
    expect(h.listPendingTodos).toHaveBeenCalledTimes(1);

    const plans = [
      { title: "背单词", plannedAt: new Date(2030, 0, 2, 9, 0).getTime(), remindAt: null },
      { title: "背单词", plannedAt: new Date(2030, 0, 2, 21, 0).getTime(),
        remindAt: new Date(2030, 0, 2, 21, 0).getTime() },
    ];
    h.listPendingTodos.mockResolvedValue([todo(1), todo(2)]);
    let accepted = false;
    await act(async () => {
      accepted = await latest!.createBatch(plans);
    });
    await flush();

    expect(accepted).toBe(true);
    expect(h.createTodoBatch).toHaveBeenCalledTimes(1);
    expect(h.createTodoBatch.mock.calls[0][0]).toEqual(plans);
    /* 成功后 reload：批量行要等真实 sort_order / id，不做本地乐观插入 */
    expect(h.listPendingTodos).toHaveBeenCalledTimes(2);
    expect(latest!.todos.map((row) => row.id)).toEqual([1, 2]);
    expect(latest!.status).toBe("ready");
  });

  it("tb02_a_rejected_batch_returns_false_and_leaves_the_list_untouched", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();
    h.createTodoBatch.mockRejectedValue(new Error("boom"));

    let accepted = true;
    await act(async () => {
      accepted = await latest!.createBatch([{ title: "背单词", plannedAt: 1, remindAt: null }]);
    });
    await flush();

    expect(accepted).toBe(false);
    expect(latest!.todos.map((row) => row.id)).toEqual([1]);
    expect(latest!.status).toBe("ready");
  });

  it("tb03_an_empty_plan_list_returns_false_without_touching_the_ipc", async () => {
    await mount();
    let accepted = true;
    await act(async () => {
      accepted = await latest!.createBatch([]);
    });
    expect(accepted).toBe(false);
    expect(h.createTodoBatch).not.toHaveBeenCalled();
  });

  it("tu01_update_forwards_the_patch_verbatim_including_explicit_nulls", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();

    let accepted = false;
    await act(async () => {
      accepted = await latest!.update(1, { title: "改了名", plannedAt: null, remindAt: null });
    });
    await flush();

    expect(accepted).toBe(true);
    expect(h.updateTodo).toHaveBeenCalledTimes(1);
    expect(h.updateTodo).toHaveBeenCalledWith(1, { title: "改了名", plannedAt: null, remindAt: null });
    /* 成功后 reload 收敛 */
    expect(h.listPendingTodos).toHaveBeenCalledTimes(2);
  });

  it("tu02_a_rejected_update_returns_false", async () => {
    await mount();
    h.updateTodo.mockRejectedValue(new Error("boom"));
    let accepted = true;
    await act(async () => {
      accepted = await latest!.update(1, { title: "x" });
    });
    await flush();
    expect(accepted).toBe(false);
  });
});
