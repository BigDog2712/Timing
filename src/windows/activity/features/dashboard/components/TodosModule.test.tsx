(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 待办卡「增删改 + 批量新建」的判据（[0.13 · 1.7]）。
 *
 * 钉的是"错了也照样出货"的静默项：
 *   ① 卡头**下方**那一行里的「新建待办」能开弹层（[本轮] 入口从卡头右槽下移到
 *      `ModuleShell` 的 `subhead` 槽，四态常驻）；
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
import TodosZone from "./TodosZone.tsx";

/* 下区的 useLayoutEffect 里 new ResizeObserver：jsdom 没有，给个空实现 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/* 真链路：挂真的 hook，这样 `model.createBatch` / `model.update` 的失败/成功路径都走生产代码 */
let latest: ReturnType<typeof useTodayTodos> | null = null;

/* [0.12.6] 待办是「今日时间线」卡的**上区**（`TodosZone`）：这一册只判待办那一半，
   所以只挂这一个区 —— 它只收 `todosModel`，计时记录源一条都不碰（不发 list_items /
   list_records），待办行为与"卡里还有没有别的区"无关。 */
function Harness(): null {
  latest = useTodayTodos(0);
  return createElement(TodosZone, {
    todosModel: latest,
    refreshError: false,
  }) as unknown as null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function todo(id: number, over: Partial<TodoSummary> = {}): TodoSummary {
  return { id, title: `待办 ${id}`, plannedAt: null, remindAt: null, doneAt: null, sortOrder: id, ...over };
}

const dialog = () => document.body.querySelector<HTMLElement>(".at-todo-dialog");
const nameInput = () => dialog()?.querySelector<HTMLInputElement>("input.at-todo-name-input") ?? null;
const dateInput = () => dialog()?.querySelector<HTMLInputElement>("input[type='date']") ?? null;
const timeInput = () => dialog()?.querySelector<HTMLInputElement>("input[type='time']") ?? null;
const remindBox = () => dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']") ?? null;
const pickers = () => Array.from(dialog()?.querySelectorAll<HTMLElement>(".at-todo-batch-picker") ?? []);
const chips = () => Array.from(dialog()?.querySelectorAll<HTMLElement>(".at-todo-batch-chip") ?? []);
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
  act(() => { byText("新建待办")?.click(); });
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

describe("上区 · 新建待办（批量）", () => {
  it("tq01_the_card_head_action_opens_the_dialog", async () => {
    await mount();
    expect(dialog()).toBeNull();
    act(() => { byText("新建待办")?.click(); });
    expect(dialog()).not.toBeNull();
    /* 焦点必须落在弹层表面内（QuietDialog 的 initialFocusRef 指向名称输入；jsdom 没有
       布局，精确断言"落在输入框"测不了，退而断言"没落在弹层外面" —— 焦点逃出弹层才是真回归）。 */
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("tq02_batch_submit_is_one_todo_create_batch_with_remindAt_equal_to_plannedAt", async () => {
    await mount();
    act(() => { byText("新建待办")?.click(); });
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
    act(() => { byText("新建待办")?.click(); });
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
    act(() => { chips()[0]?.querySelector<HTMLButtonElement>(".at-todo-batch-chip-remove")?.click(); });
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
    act(() => { byText("新建待办")?.click(); });
    expect(dialog()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    await flush();
    expect(dialog()).toBeNull();
  });
});

describe("上区 · 「新建待办」那一行的位置", () => {
  it("tq08_the_entry_lives_below_the_card_head_and_survives_the_empty_state", async () => {
    /* 空态（今天一条待办都没有）必须**也有**入口：这正是「新建」最该出现的时刻，
       也是 old 版把它放在 footer 的唯一理由。搬到区标题行下方之后这条语义不许丢。 */
    await mount();
    /* 区根节点带 `data-zone="todos"`：上区=待办、下区=时间线，两区靠它区分（见
       `TimelineTodosCard.test.tsx` 的顺序判据）。 */
    expect(container?.querySelector('[data-zone="todos"]'), "待办区没有 data-zone 标记").not.toBeNull();
    const entry = byText("新建待办");
    expect(entry, "空态没有「新建待办」= 入口被四态门控吃掉了").not.toBeUndefined();
    expect(entry?.closest(".at-todo-new-row"), "入口必须在那条通栏窄行里（区标题行之下、列表之上）")
      .not.toBeNull();
    expect(entry?.closest(".at-items-zone-head"), "入口不许挤进区标题行（那行要留给标题与读数）")
      .toBeNull();
    expect(container?.querySelector(".at-card-foot, .at-todo-foot"), "卡底那条入口条必须已经下线")
      .toBeNull();
  });

  it("tq09_the_entry_row_sits_after_the_zone_head_and_before_the_list", async () => {
    /* 位置判据（用户口径「往下挪」）：那一行紧跟在**区标题行**之后，且排在列表之前。
       搬进区标题行 / 掉到列表下面都会被这一条挡住 —— 变异靶点。 */
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();
    const head = container?.querySelector(".at-items-zone-head");
    const row = container?.querySelector(".at-todo-new-row");
    const list = container?.querySelector(".at-todo-list");
    expect(head, "找不到区标题行").not.toBeNull();
    expect(row, "找不到「新建待办」那一行").not.toBeNull();
    expect(list, "ready 态应有列表").not.toBeNull();
    expect(head?.nextElementSibling, "那一行必须紧跟在区标题行之后").toBe(row);
    /* `compareDocumentPosition`：row 在 list **之前**（FOLLOWING 位） */
    expect((row as Node).compareDocumentPosition(list as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    /* 区标题行里不摆入口键：那一行留给标题 / 读数 / 总计 */
    expect(container?.querySelector(".at-items-zone-head .at-link-btn"), "区标题行里不该有入口键")
      .toBeNull();
  });
});

describe("上区 · 列表全量渲染（V-1.7a）", () => {
  it("tq07_eight_todos_render_eight_rows_and_the_meta_counts_them_all", async () => {
    /* 显示**所有**未完成待办 —— 前端切片截断会让"还有 N 项"之外的事永远看不见 */
    h.listPendingTodos.mockResolvedValue(Array.from({ length: 8 }, (_, i) => todo(i + 1)));
    await mount();

    const rows = container?.querySelectorAll(".at-todo-row") ?? [];
    expect(rows).toHaveLength(8);
    /* 读数在上区标题行（`.at-todo-meta`）；总计是下区标题行的 `.at-card-meta`，两码事 */
    const meta = container?.querySelector(".at-todo-meta")?.textContent ?? "";
    expect(meta).toContain("8 条待办");
  });
});

/**
 * [0.12.6] 并进时间线卡**没有**削掉待办能力 —— 这条是"两张卡变一张"最大的回归面。
 *
 * 搬迁最容易出的三种静默退化，都不报错、只是"少了点什么"：
 *   ① 勾选 / 提醒铃铛 / 时间胶囊 / 编辑键里少了任何一个（行还在，功能没了）；
 *   ② 勾选后不再有 3 秒撤销条（用户勾错一次就只能自己去后端改回来）；
 *   ③ 编辑键点了没反应（`onEdit` 忘了接线，弹层状态改了但消费它的组件没挂载）。
 * 所以这里判的是**行上的可交互元素 + 它们真的通到写命令**，不是"渲染了 8 行"。
 */
describe("上区 · 待办能力在合并卡里原样保留（0.12.6）", () => {
  /** 今天 09:30：时间胶囊与提醒铃铛都按本地时分渲染 */
  const today = new Date();
  today.setHours(9, 30, 0, 0);
  const NINE_THIRTY = today.getTime();

  const row = () => container?.querySelector<HTMLElement>(".at-todo-row") ?? null;

  it("tq10_a_row_still_carries_checkbox_reminder_bell_time_chip_and_edit_key", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1, { plannedAt: NINE_THIRTY, remindAt: NINE_THIRTY })]);
    await mount();

    /* 勾选：`role=checkbox` + 状态换成"目标状态"，读屏用户才不会重复做同一件事 */
    const check = row()?.querySelector<HTMLElement>(".at-todo-check");
    expect(check?.getAttribute("role")).toBe("checkbox");
    expect(check?.getAttribute("aria-checked")).toBe("false");
    /* 时间胶囊：计划时刻（没排期时这一格整个不画，见 `PlannedChip`） */
    expect(row()?.querySelector(".at-todo-time")?.textContent).toBe("09:30");
    /* 提醒铃铛：`remindAt` 非 null 才有 */
    expect(row()?.querySelector(".at-todo-bell")?.getAttribute("aria-label")).toContain("09:30");
    /* 编辑键仍在（按 id 打开单条编辑弹层） */
    expect(row()?.querySelector(".at-todo-edit")?.getAttribute("aria-label")).toContain("编辑");
  });

  it("tq11_ticking_the_box_writes_through_and_leaves_an_undo_bar", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1)]);
    await mount();

    act(() => { row()?.querySelector<HTMLButtonElement>(".at-todo-check")?.click(); });
    await flush();

    /* 勾选 = 立即落库；撤销条同时出现（3 秒内可反悔） */
    expect(h.toggleTodo).toHaveBeenCalledWith(1, true);
    expect(container?.querySelectorAll(".at-todo-row")).toHaveLength(0);
    const undo = container?.querySelector<HTMLButtonElement>(".at-undo-btn");
    expect(undo?.textContent).toBe("撤销");

    /* 撤销 = 反向再调一次（`todo_toggle` 已落库，不能靠"不发请求"撤销） */
    act(() => undo?.click());
    await flush();
    expect(h.toggleTodo).toHaveBeenLastCalledWith(1, false);
    expect(container?.querySelectorAll(".at-todo-row")).toHaveLength(1);
  });

  it("tq12_the_edit_key_opens_the_row_dialog_prefilled", async () => {
    h.listPendingTodos.mockResolvedValue([todo(1, { title: "看论文", plannedAt: NINE_THIRTY })]);
    await mount();

    act(() => { row()?.querySelector<HTMLButtonElement>(".at-todo-edit")?.click(); });
    await flush();

    /* 弹层是本区根节点的兄弟（不是列表的 children）：挂进条件分支就会"点得到没反应" */
    const editor = document.body.querySelector<HTMLElement>(".at-todo-dialog");
    expect(editor, "编辑键点了没有弹出编辑层").not.toBeNull();
    expect(editor?.querySelector<HTMLInputElement>("input.at-todo-name-input")?.value).toBe("看论文");
  });
});
