(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 时间线**下区** R2 重做的行为判据（0.13 · 1.6 / T03b）—— 纯函数判据在
 * `TimelineCard.test.ts`（行形）与 `services/recordTimeEdit.test.ts`（B1–B6）。
 *
 * 钉的是"错了也照样渲染 / 照样发"的静默项：
 *   · V-1.6a：区标题行只留**总计**读数，一颗唤起按钮都没有；卡底三入口（新建 / 编辑 /
 *     事项管理）[0.12.6] 已整组搬进 `ManageCard`，本区一个都不许留 —— 同一个动作在两张
 *     卡上各有一颗按钮，用户对"这个按钮在哪张卡上"会永久地失败；
 *   · V-1.6e / B4：「改起止」保存 = **恰一条** `update_record_time`，payload 只有
 *     `{recordId, startedAt, endedAt}`（camelCase）——**没有**时长字段（B4，
 *     `accumulated_sec` 由 Rust 重算）；
 *   · [2026-11-20] 改起止已并入「编辑事项」弹层：行右侧那颗悬停才浮出的按钮必须
 *     消失（`at-timeline-record-edit` 零元素）；输入只有 `time`，没有日期；
 *   · B1 / B2：只改时刻时跨零点表达不出来 —— 填 23:30–01:00 会就地报「结束要晚于
 *     开始」且**不发意图**（Rust 不按天拆分，绝不能让这种行落库）；
 *   · V-1.6g / B3：进行中的段保存键 disabled + 行上显式给 `onlySavedEditable`。
 *
 * V-1.6c（编辑事项弹层恰一条 `update_item`）随入口一起搬到了 `ManageCard.test.tsx`。
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
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import TimelineZone from "./TimelineZone.tsx";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";

const COPY = DASHBOARD_COPY["zh-CN"];

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
  await resolveAndMount(createElement(TimelineZone, {
    items,
    total: items.reduce((sum, row) => sum + row.value, 0),
    status: "ready",
    onRetry: () => undefined,
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

/** 改起止只改时刻：`time` 输入的值是 `HH:mm`，不带日期 */
function formatClock(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

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

describe("下区 · 总计读数与入口（V-1.6a → [0.13.x] 恢复新建/编辑）", () => {
  it("tc01_the_zone_head_carries_the_total_and_the_two_item_entries", async () => {
    await mount([itemRow()]);
    /* 区标题行右侧 = 总计读数（来自 `useTodayItems.total`，后端口径）。
       [0.12.6] 总计从"卡头"下移到"下区标题行"：卡头现在归合并卡（标题 + 布局工具条）。 */
    const head = container?.querySelector(".at-items-zone-head");
    expect(head?.textContent).toContain("总计 1h 20m");
    /* [0.13.x] 主人口径：**恢复「新建事项」「编辑事项」**，挂在本区标题行（四态之外常驻）。 */
    const labels = Array.from(head?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .map((button) => (button.textContent ?? "").trim());
    expect(labels).toEqual([COPY.timelineNewItem, COPY.timelineEditItem]);
  });

  it("tc02_the_manage_entry_is_not_duplicated_here", async () => {
    await mount([itemRow()]);
    /* 「事项管理」仍住在 `ManageCard`：同一个动作在两张卡上各有一颗按钮，
       用户对"按钮在哪"会永久失败。本区只恢复新建 / 编辑两个入口。 */
    expect(container?.querySelector(".at-timeline-manage"), "卡底入口条又长回来了").toBeNull();
    const labels = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .map((button) => (button.textContent ?? "").trim());
    expect(labels).not.toContain(COPY.timelineManageItems);
    /* 区根节点带 `data-zone="timeline"`：上区是待办（`data-zone="todos"`），这里判的是下区 */
    expect(container?.querySelector('[data-zone="timeline"]'), "下区没有 data-zone 标记").not.toBeNull();
  });

  it("tc02b_the_entries_open_their_dialogs_even_when_today_is_empty", async () => {
    /* 空态恰恰是最需要「新建」的时刻：入口在四态之外，弹层必须真的挂上
       （挂进分支 = 点了零反应，判据同 `TimelineCardEntry.test.tsx`）。 */
    await mount([]);
    const button = (label: string) =>
      Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-items-zone-actions button") ?? [])
        .find((entry) => (entry.textContent ?? "").trim() === label) ?? null;
    act(() => { button(COPY.timelineNewItem)?.click(); });
    await flush();
    expect(document.body.querySelector(".at-dialog-surface .at-dialog-title")?.textContent)
      .toBe(COPY.timelineCreateTitle);
  });

  it("tc02c_the_row_no_longer_pops_out_a_record_edit_entry", async () => {
    /* [2026-11-20] 改起止并入「编辑事项」：行右侧不许再有悬停才浮出的第四列。
       同一动作藏在 hover 里 = 用户永远找不到；现在入口是它已经会用的那一颗。 */
    await mount([itemRow()]);
    expect(container?.querySelector(".at-timeline-record-edit"), "行上的改起止按钮又长回来了").toBeNull();
    expect(container?.querySelector("button[aria-label='改起止 事项 A']")).toBeNull();
  });

  it("tc03_rows_show_name_range_and_total", async () => {
    await mount([itemRow()]);
    const row = container?.querySelector(".at-timeline-row");
    expect(row?.querySelector(".at-timeline-label")?.textContent).toBe("事项 A");
    expect(row?.querySelector(".at-timeline-range")?.textContent).toBe("09:00–10:30");
    expect(row?.querySelector(".at-timeline-duration")?.textContent).toBe("1h 20m");
  });

  it("tc04_a_running_row_says_now_not_a_blank_end", async () => {
    /* V-1.6b：`lastEnd === null` → 止列 = "此刻 · 进行中"，不是空白 */
    await mount([itemRow({ lastEnd: null })]);
    const range = container?.querySelector(".at-timeline-range")?.textContent ?? "";
    expect(range).toContain("进行中");
    expect(container?.querySelector(".at-timeline-row")?.hasAttribute("data-running")).toBe(true);
  });

  it("tc04b_a_paused_row_says_paused_instead_of_running", async () => {
    /* 暂停 = 数字不再涨：写"进行中"会让用户以为还在走，写此刻钟点更糟 */
    await mount([itemRow({ lastEnd: null, paused: true })]);
    const range = container?.querySelector(".at-timeline-range")?.textContent ?? "";
    expect(range).toBe(COPY.timelinePaused);
    expect(container?.querySelector(".at-timeline-row")?.hasAttribute("data-paused")).toBe(true);
  });
});

describe("下区 · 常用事项组下线（[本轮] 主人口径）", () => {
  /* [本轮] 「常用事项」组整组下线：这张卡只回答“今天做了什么”，一键起停归「事项管理」卡。
     旧判据（tc04c/tc04d 钉组内行与点击起停）随组一起退场。 */
  it("tc04e_the_pinned_group_never_renders_anymore", async () => {
    await mount([itemRow()]);
    expect(container?.querySelector('[data-group="pinned"]'), "常用事项组又长回来了").toBeNull();
    expect(container?.querySelector(".at-items-group"), "任何事项分组都不许出现在时间线卡上").toBeNull();
    expect(container?.querySelector(".at-items-row-main"), "组行起停按钮又长回来了").toBeNull();
  });
});

describe("下区 · 改起止（[2026-11-20] 并入编辑事项，只改时刻）", () => {
  /** 打开「编辑事项」→ 选中今天唯一的事项 → 等「今日记录」区就绪 */
  async function openRecordSection() {
    await mount([itemRow()]);
    act(() => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-items-zone-actions button") ?? [])
        .find((button) => (button.textContent ?? "").trim() === COPY.timelineEditItem)
        ?.click();
    });
    await flush();
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".at-timeline-edit-choice")?.click();
    });
    await flush();
    expect(document.body.querySelector(".at-record-time")).not.toBeNull();
    expect(document.body.querySelectorAll(".at-record-time-row")).toHaveLength(1);
  }

  const expandFirstSegment = () => {
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".at-record-time-row .at-timeline-item-action")?.click();
    });
  };
  const editorSave = () =>
    document.body.querySelector<HTMLButtonElement>(".at-record-time-editor .at-button-primary");
  const editorInputs = () =>
    Array.from(document.body.querySelectorAll<HTMLInputElement>(
      ".at-record-time-editor input[type='time']",
    ));

  it("tc06_save_emits_exactly_one_camel_case_intent_without_a_duration_field", async () => {
    await openRecordSection();
    expect(document.body.querySelector(".at-record-time-title")?.textContent).toBe("今日记录");
    expandFirstSegment();
    await flush();

    const inputs = editorInputs();
    expect(inputs).toHaveLength(2);
    /* 只改时刻：日期不摆在界面上，锚点由记录自己带 */
    expect(document.body.querySelector(".at-record-time-editor input[type='datetime-local']")).toBeNull();
    typeInto(inputs[0], formatClock(DAY + 9 * HOUR));
    typeInto(inputs[1], formatClock(DAY + 10.5 * HOUR));
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

  it("tc07_a_backwards_edit_that_would_cross_midnight_is_refused_in_place", async () => {
    await openRecordSection();
    expandFirstSegment();
    await flush();

    /* 只改时刻时跨零点表达不出来：填 23:30–01:00 会走 B1。绝不能让这条落库 ——
       Rust 不按天拆分，跨零点行会把整天时长算给起始日且零报错。 */
    const inputs = editorInputs();
    typeInto(inputs[0], "23:30");
    typeInto(inputs[1], "01:00");
    act(() => { editorSave()?.click(); });
    await flush();

    expect(issueText()).toContain("结束时刻要晚于开始");
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
      Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-items-zone-actions button") ?? [])
        .find((button) => (button.textContent ?? "").trim() === COPY.timelineEditItem)
        ?.click();
    });
    await flush();
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".at-timeline-edit-choice")?.click();
    });
    await flush();
    expect(document.body.querySelectorAll(".at-record-time-row")).toHaveLength(2);

    /* B3 的 UI 形态：进行中的段行上**显示**说明（不是空白、不是英文码） */
    const notes = Array.from(document.body.querySelectorAll(".at-record-time-note"))
      .map((node) => node.textContent ?? "");
    expect(notes).toContain("进行中的记录要等结束之后才能改");

    /* 展开进行中那一段：输入随便填多合法，保存键也必须 disabled */
    const runningRow = document.body.querySelectorAll(".at-record-time-row")[1];
    act(() => { runningRow.querySelector<HTMLButtonElement>(".at-timeline-item-action")?.click(); });
    await flush();
    const inputs = editorInputs();
    typeInto(inputs[0], formatClock(DAY + 11 * HOUR));
    typeInto(inputs[1], formatClock(DAY + 12 * HOUR));
    expect(editorSave()?.disabled).toBe(true);
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });
});
