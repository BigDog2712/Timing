(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 时间线卡 R2 重做的**行为**判据（0.13 · 1.6 / T03b）—— 纯函数判据在
 * `TimelineCard.test.ts`（行形）与 `services/recordTimeEdit.test.ts`（B1–B6）。
 *
 * 钉的是"错了也照样渲染 / 照样发"的静默项：
 *   · V-1.6a：卡头不再有「常用事项 / 事项菜单」两颗唤起按钮（入口收敛到卡底三键），
 *     卡头右侧只留**总计**读数；卡底**恰好三颗**（多一颗 = 入口又漏了）；
 *   · V-1.6c：「编辑事项」弹层保存 = **恰一条** `update_item` 意图（多发 = 药丸上
 *     多次落库；字段名漂一个 = 静默落进 default 分支）；
 *   · V-1.6e / B4：「改起止」保存 = **恰一条** `update_record_time`，payload 只有
 *     `{recordId, startedAt, endedAt}`（camelCase）——**没有**时长字段（B4，
 *     `accumulated_sec` 由 Rust 重算）；
 *   · B2：跨零点的改法**不发意图**、就地给 `crossDayHint`（Rust 不按天拆分）；
 *   · V-1.6g / B3：进行中的段保存键 disabled + 行上显式给 `onlySavedEditable`。
 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingRecords: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
  listTimingRecords: h.listTimingRecords,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import { formatDateTimeLocal } from "../services/todoDraft.ts";
import TimelineCard from "./TimelineCard.tsx";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";

/* 弹层判域 = 挂载那一刻的"今天"（组件里 `new Date()` 现算），测试里也用真实今天，
   不写死 2026 —— 否则日界一漂，合法改法会被 crossDay 误拦（或反过来）。 */
function localDayStart(): number {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

const HOUR = 3_600_000;
const DAY = localDayStart();

function itemRow(over: Partial<TodayItemRow> = {}): TodayItemRow {
  return {
    itemId: 11,
    name: "事项 A",
    color: "",
    value: 80 * 60_000,
    firstStart: DAY + 9 * HOUR,
    lastEnd: DAY + 10.5 * HOUR,
    segments: 3,
    ...over,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(items: TodayItemRow[]) {
  await resolveAndMount(createElement(TimelineCard, {
    items,
    total: items.reduce((sum, row) => sum + row.value, 0),
    tier: "M",
    status: "ready",
    refreshError: false,
    onRetry: () => undefined,
    onLocalRename: () => undefined,
    onLocalCreate: () => undefined,
  }));
}

async function resolveAndMount(element: ReactElement) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => { root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })); });
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

const footerButtons = () =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-timeline-manage button") ?? []);
const byText = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === text);
const issueText = () =>
  Array.from(document.body.querySelectorAll('[role="alert"], [role="status"]') ?? [])
    .map((node) => node.textContent ?? "")
    .join(" | ");

beforeEach(() => {
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([
    { id: 11, name: "事项 A", color: "", isSystem: false, isPinned: true, sortOrder: 1, updatedAt: 5 },
    { id: 12, name: "事项 B", color: "", isSystem: false, isPinned: false, sortOrder: 2, updatedAt: 9 },
  ]);
  h.listTimingRecords.mockReset();
  h.listTimingRecords.mockResolvedValue([
    { id: 101, itemId: 11, startedAt: DAY + 9 * HOUR, endedAt: DAY + 10 * HOUR, accumulatedSec: 3600, status: "saved" },
  ]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({});
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

describe("TimelineCard · 入口收敛与总计（V-1.6a）", () => {
  it("tc01_header_has_no_menu_buttons_and_only_the_total_readout", async () => {
    await mount([itemRow()]);
    /* 卡头右侧 = 总计读数（来自 `useTodayItems.total`，后端口径） */
    const head = container?.querySelector(".qp-card-head");
    expect(head?.textContent).toContain("总计 1h 20m");
    /* 「常用事项 / 事项菜单」两颗唤起按钮已删：卡头一颗按钮都不该有 */
    expect(head?.querySelectorAll("button")).toHaveLength(0);
  });

  it("tc02_footer_has_exactly_three_entry_buttons", async () => {
    await mount([itemRow()]);
    const buttons = footerButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.textContent))
      .toEqual(["＋ 新建事项", "编辑事项", "事项管理"]);
  });

  it("tc03_rows_show_name_range_and_total", async () => {
    await mount([itemRow()]);
    const row = container?.querySelector(".qp-timeline-row");
    expect(row?.querySelector(".qp-timeline-label")?.textContent).toBe("事项 A");
    expect(row?.querySelector(".qp-timeline-range")?.textContent).toBe("09:00–10:30");
    expect(row?.querySelector(".qp-timeline-duration")?.textContent).toBe("1h 20m");
  });

  it("tc04_a_running_row_says_now_not_a_blank_end", async () => {
    /* V-1.6b：`lastEnd === null` → 止列 = "此刻 · 进行中"，不是空白 */
    await mount([itemRow({ lastEnd: null })]);
    const range = container?.querySelector(".qp-timeline-range")?.textContent ?? "";
    expect(range).toContain("进行中");
    expect(container?.querySelector(".qp-timeline-row")?.hasAttribute("data-running")).toBe(true);
  });
});

describe("TimelineCard · 编辑事项弹层（V-1.6c）", () => {
  it("tc05_edit_save_emits_exactly_one_update_item_intent", async () => {
    await mount([itemRow()]);
    act(() => { byText("编辑事项")?.click(); });
    await flush();

    /* 先选事项，再改名称 + 默认时长（候选按 updatedAt 倒序 —— 按名字找，不按下标） */
    const choices = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".qp-timeline-edit-choice"));
    act(() => {
      choices.find((button) => button.textContent?.includes("事项 A"))?.click();
    });
    await flush();
    const nameInput = document.body.querySelector<HTMLInputElement>(
      ".qp-timeline-manage-dialog input.qp-timeline-manage-input",
    );
    expect(nameInput?.value).toBe("事项 A");
    typeInto(nameInput, "事项 A2");

    act(() => { byText("确认")?.click(); });
    await flush();

    /* 恰一条意图；`timerMinutes` 显式发（留空 = null = 清默认时长） */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_item",
      id: 11,
      name: "事项 A2",
      timerMinutes: null,
    });
  });
});

describe("TimelineCard · 改起止弹层（V-1.6e / B2 / B3）", () => {
  /** 打开「改起止」并等段列表就绪 */
  async function openRecordDialog() {
    await mount([itemRow()]);
    act(() => {
      container?.querySelector<HTMLButtonElement>("button[aria-label='改起止 事项 A']")?.click();
    });
    await flush();
    expect(document.body.querySelector(".qp-record-time")).not.toBeNull();
    expect(document.body.querySelectorAll(".qp-record-time-row")).toHaveLength(1);
  }

  const editorSave = () =>
    document.body.querySelector<HTMLButtonElement>(".qp-record-time-editor .qp-button-primary");
  const editorInputs = () =>
    Array.from(document.body.querySelectorAll<HTMLInputElement>(
      ".qp-record-time-editor input[type='datetime-local']",
    ));

  it("tc06_save_emits_exactly_one_camel_case_intent_without_a_duration_field", async () => {
    await openRecordDialog();
    /* 逐段改（B5）：点这一段的「改起止」展开编辑器 */
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".qp-record-time-row .qp-timeline-item-action")?.click();
    });
    await flush();

    const inputs = editorInputs();
    expect(inputs).toHaveLength(2);
    typeInto(inputs[0], formatDateTimeLocal(DAY + 9 * HOUR));
    typeInto(inputs[1], formatDateTimeLocal(DAY + 10.5 * HOUR));
    act(() => { editorSave()?.click(); });
    await flush();

    /* 恰一条意图，字段 camelCase、逐字钉死；payload **没有**时长字段（B4：
       accumulated_sec 由 Rust 重算，RecordPatch 里塞 duration 会被 serde 丢掉） */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_record_time",
      recordId: 101,
      startedAt: DAY + 9 * HOUR,
      endedAt: DAY + 10.5 * HOUR,
    });
    /* 发出即显示"已保存，稍后刷新生效"（意图无回执，账目由刷新收敛） */
    expect(issueText()).toContain("已保存，稍后刷新生效");
  });

  it("tc07_a_cross_midnight_edit_is_refused_in_place_and_emits_nothing", async () => {
    await openRecordDialog();
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".qp-record-time-row .qp-timeline-item-action")?.click();
    });
    await flush();

    /* 结束推到次日 01:00（跨零点）：B2 必须在前端拦 —— Rust 不按天拆分，
       跨零点行会让整天时长算给起始日且零报错 */
    const inputs = editorInputs();
    typeInto(inputs[0], formatDateTimeLocal(DAY + 23.5 * HOUR));
    typeInto(inputs[1], formatDateTimeLocal(DAY + 24 * HOUR + HOUR));
    act(() => { editorSave()?.click(); });
    await flush();

    expect(issueText()).toContain("跨零点的记录请在两天里分别修改");
    /* 拦在门口：一个意图都不许发出去 */
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });

  it("tc08_a_running_segment_is_disabled_and_says_so_b3", async () => {
    h.listTimingRecords.mockResolvedValue([
      { id: 101, itemId: 11, startedAt: DAY + 9 * HOUR, endedAt: DAY + 10 * HOUR, accumulatedSec: 3600, status: "saved" },
      { id: 102, itemId: 11, startedAt: DAY + 11 * HOUR, endedAt: null, accumulatedSec: 600, status: "running" },
    ]);
    await mount([itemRow()]);
    act(() => {
      container?.querySelector<HTMLButtonElement>("button[aria-label='改起止 事项 A']")?.click();
    });
    await flush();
    expect(document.body.querySelectorAll(".qp-record-time-row")).toHaveLength(2);

    /* B3 的 UI 形态：进行中的段行上**显示**说明（不是空白、不是英文码） */
    const notes = Array.from(document.body.querySelectorAll(".qp-record-time-note"))
      .map((node) => node.textContent ?? "");
    expect(notes).toContain("进行中的记录要等结束之后才能改");

    /* 展开进行中那一段：输入随便填多合法，保存键也必须 disabled */
    const runningRow = document.body.querySelectorAll(".qp-record-time-row")[1];
    act(() => { runningRow.querySelector<HTMLButtonElement>(".qp-timeline-item-action")?.click(); });
    await flush();
    const inputs = editorInputs();
    typeInto(inputs[0], formatDateTimeLocal(DAY + 11 * HOUR));
    typeInto(inputs[1], formatDateTimeLocal(DAY + 12 * HOUR));
    expect(editorSave()?.disabled).toBe(true);
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });
});
