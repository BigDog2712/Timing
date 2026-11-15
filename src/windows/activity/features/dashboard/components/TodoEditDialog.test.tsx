(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「编辑待办」弹层（[0.13 · 1.7] 的"改"）的判据 —— 从 `TodosModule.test.tsx` 拆出
 * （两个文件各自钉一条路径，塞一起必破 300 行棘轮）。
 *
 * 钉的是"错了也照样出货"的静默项：
 *   ① 打开时以那条待办为初值（提醒勾选随 `remindAt`，不是恒关）；
 *   ② 保存 = **一条** `todo_update`，patch 三态逐字转发：显式 `null` = 清空
 *      （Rust `TodoPatch` 的 double_option 靠 JSON null 与缺键区分"清空"和"不改"；
 *      patch 里悄悄省键 = 字段永远清不掉）；
 *   ③ 勾了提醒 + 有时间 → `remindAt === plannedAt`（同一时刻，与新建同一条规则）；
 *   ④ 清除时间 = 不排期，连带取消提醒（提醒勾选 disabled）；
 *   ⑤ 失败（update 返回 false）→ 弹层仍开 + 一句失败提示（失败"演成成功"会让
 *      用户以为改好了，实际库里没变）。
 */
const h = vi.hoisted(() => ({
  updateTodo: vi.fn(async (_id?: unknown, _patch?: unknown): Promise<void> => undefined),
}));

vi.mock("../../../platform/persistence/todoRepository.ts", () => ({
  updateTodo: h.updateTodo,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { useTodayTodos } from "../hooks/useTodayTodos.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import TodoEditDialog from "./TodoEditDialog.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function todo(over: Partial<TodoSummary> = {}): TodoSummary {
  return {
    id: 1,
    title: "看论文",
    plannedAt: null,
    remindAt: null,
    doneAt: null,
    sortOrder: 1,
    ...over,
  };
}

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

/** 真链路：`update` 用 `useTodayTodos().update`（失败/成功路径都是生产代码） */
let latest: ReturnType<typeof useTodayTodos> | null = null;

async function mount(withTodo: TodoSummary | null) {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(() => {
        latest = useTodayTodos(0);
        return createElement(TodoEditDialog, {
          todo: withTodo,
          onClose: () => undefined,
          update: latest.update,
        });
      }),
    }));
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
  h.updateTodo.mockReset();
  h.updateTodo.mockResolvedValue(undefined);
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

describe("TodoEditDialog · 行编辑", () => {
  it("td01_opens_prefilled_from_the_todo", async () => {
    await mount(todo({ plannedAt: new Date(2030, 0, 2, 9, 0).getTime() }));
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain("编辑待办");
    expect(nameInput()?.value).toBe("看论文");
    /* 提醒初值随那条待办的 remindAt（null → 未勾） */
    expect(remindBox()?.checked).toBe(false);
  });

  it("td02_clearing_time_saves_explicit_nulls", async () => {
    await mount(todo({ plannedAt: new Date(2030, 0, 2, 9, 0).getTime() }));
    /* 清除时间 = 不排期，连带取消提醒 → patch 两个显式 null（不是省键） */
    act(() => { byText("清除时间")?.click(); });
    expect(remindBox()?.disabled).toBe(true);
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.updateTodo).toHaveBeenCalledTimes(1);
    expect(h.updateTodo).toHaveBeenCalledWith(1, { title: "看论文", plannedAt: null, remindAt: null });
  });

  it("td03_time_plus_remind_lands_the_same_moment_twice", async () => {
    await mount(todo());
    typeInto(timeInput(), "2030-01-02T09:00");
    act(() => { remindBox()?.click(); });
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.updateTodo).toHaveBeenCalledTimes(1);
    const patch = h.updateTodo.mock.calls[0][1] as { plannedAt: number; remindAt: number };
    expect(patch.plannedAt).toBe(new Date(2030, 0, 2, 9, 0).getTime());
    expect(patch.remindAt).toBe(patch.plannedAt);
  });

  it("td04_a_failed_update_keeps_the_dialog_open_and_says_so", async () => {
    h.updateTodo.mockRejectedValue(new Error("boom"));
    await mount(todo());
    act(() => { byText("确认")?.click(); });
    await flush();

    expect(h.updateTodo).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(nameInput()?.value).toBe("看论文");
    expect(statusText()).toContain("没能创建这条待办，请重试");
  });

  it("td05_closed_dialog_renders_nothing", async () => {
    await mount(null);
    expect(dialog()).toBeNull();
    expect(h.updateTodo).not.toHaveBeenCalled();
  });
});
