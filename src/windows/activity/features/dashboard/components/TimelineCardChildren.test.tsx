(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 时间轴第二层（T18）的**行为**判据。
 *
 * 钉三条：
 *   1. 没有子记录时不出现展开键 —— 出现一个点了没反应的三角，等于告诉用户「这里有东西」；
 *   2. 展开后 `segments` 与 `gaps` **按起点合并排序**（各自有序不代表合起来有序）；
 *   3. 「未采集」以 `data-gap` 渲染（不是 0 秒的应用段，也不是 `other` 分类）。
 */
const h = vi.hoisted(() => ({
  getItemTimeline: vi.fn(async (): Promise<unknown[]> => []),
  emitHostIntent: vi.fn(async () => true),
}));

vi.mock("../../../platform/persistence/attributionGateway.ts", () => ({
  getItemTimeline: h.getItemTimeline,
}));
vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: vi.fn(async () => []),
  listTimingRecords: vi.fn(async () => []),
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({
  getSettings: vi.fn(async () => ({})),
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimelineZone from "./TimelineZone.tsx";
import { buildChildEntries, categoryLabelOf } from "./TimelineChildRows.tsx";
import type { ItemTimelineRow } from "../../../platform/persistence/attributionGateway.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";

const DAY_START = new Date(2026, 10, 14, 0, 0, 0, 0).getTime();
const at = (hour: number, minute: number) => DAY_START + (hour * 60 + minute) * 60_000;

const ITEMS: TodayItemRow[] = [
  {
    itemId: 7,
    name: "学习 SQL",
    color: "#123456",
    value: 120 * 60_000,
    firstStart: at(9, 30),
    lastEnd: at(11, 30),
    segments: 1,
  },
];

function timelineRow(overrides: Partial<ItemTimelineRow> = {}): ItemTimelineRow {
  return {
    itemUid: `i:aaaaaaaaaaaa:7`,
    itemName: "学习 SQL",
    categoryKey: "study",
    startMs: at(9, 30),
    endMs: at(11, 30),
    running: false,
    totalMs: 120 * 60_000,
    blockCount: 1,
    segments: [
      { appKey: "chrome", appName: "chrome", deviceId: "pc-a", startMs: at(9, 30), endMs: at(11, 0), categoryKey: "study" },
      { appKey: "pycharm", appName: "pycharm", deviceId: "pc-a", startMs: at(11, 10), endMs: at(11, 30), categoryKey: "study" },
    ],
    gaps: [{ startMs: at(11, 0), endMs: at(11, 10) }],
    totalsByCategory: { study: 110 * 60_000 },
    ...overrides,
  };
}

describe("时间轴第二层", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    h.getItemTimeline.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(rows: TodayItemRow[], detail: ItemTimelineRow[]) {
    h.getItemTimeline.mockResolvedValue(detail);
    /* `resolveLocaleActivation` 是「加载文案」的动作，`LocaleProvider` 只收 `locale`。
       把它的 Promise 当 activation 塞进 provider 会让 provider 拿到函数 —— 报
       `isCurrent is not a function`，而用例本身可能照样绿（这里就是）。 */
    await resolveLocaleActivation("zh-CN", () => true);
    await act(async () => {
      root.render(
        createElement(LocaleProvider, {
          locale: "zh-CN" as const,
          children: createElement(TimelineZone, {
            items: rows,
            total: rows.reduce((sum, row) => sum + row.value, 0),
            status: "ready" as const,
            onRetry: () => {},
          }),
        }),
      );
    });
  }

  it("没有子记录时不渲染展开键", async () => {
    await render(ITEMS, []);
    expect(container.querySelector(".at-timeline-toggle")).toBeNull();
  });

  it("展开后按起点合并渲染应用段与未采集空档", async () => {
    await render(ITEMS, [timelineRow()]);
    const toggle = container.querySelector<HTMLButtonElement>(".at-timeline-toggle");
    expect(toggle, "有子记录就必须有展开键").not.toBeNull();

    await act(async () => toggle!.click());

    const rows = Array.from(container.querySelectorAll(".at-timeline-child"));
    expect(rows).toHaveLength(3);
    /* 09:30 chrome → 11:00 空档 → 11:10 pycharm：按起点排序，空档夹在中间。 */
    expect(rows[0].textContent).toContain("chrome");
    expect(rows[1].getAttribute("data-gap")).not.toBeNull();
    expect(rows[1].textContent).toContain("未采集");
    expect(rows[2].textContent).toContain("pycharm");
  });

  it("再点一次收起", async () => {
    await render(ITEMS, [timelineRow()]);
    const toggle = container.querySelector<HTMLButtonElement>(".at-timeline-toggle")!;
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(container.querySelectorAll(".at-timeline-child")).toHaveLength(0);
  });
  it("单设备时一个设备角标都不出现", async () => {
    /* 单设备是常态。「界面上不许出现设备元素」这条在历史页已经是一条验收断言，
       这里复用同一个 `buildDeviceLanes`（≤1 台返回 `[]`），避免出现第二套判据。 */
    await render(ITEMS, [timelineRow({ selfDeviceId: "pc-a" })]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".at-timeline-toggle")!.click();
    });
    expect(container.querySelectorAll(".at-timeline-child-device").length).toBe(0);
  });

  it("双端并行时每段带自己的设备角标", async () => {
    /* 同一事项、同一应用，两端各跑一段：不带设备时这两行长得一模一样，
       用户的第一反应是「重复记录了」。 */
    await render(ITEMS, [
      timelineRow({
        selfDeviceId: "pc-a",
        gaps: [],
        segments: [
          { appKey: "chrome", appName: "chrome", deviceId: "pc-a", startMs: at(9, 30), endMs: at(10, 0), categoryKey: "study" },
          { appKey: "chrome", appName: "chrome", deviceId: "phone-b", startMs: at(10, 0), endMs: at(10, 30), categoryKey: "study" },
        ],
      }),
    ]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".at-timeline-toggle")!.click();
    });
    const badges = [...container.querySelectorAll(".at-timeline-child-device")];
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).not.toBe(badges[1].textContent);
  });
});

describe("第二层纯函数", () => {
  it("空档与段落按起点合并排序（不是先段落后空档）", () => {
    /* 交错构造：段落 09:30 与 11:10、空档 11:00。不排序就会渲染成
       09:30 / 11:10 / 11:00 —— 用户看到「时间倒着走」，而数据一字不差。 */
    const entries = buildChildEntries(
      timelineRow({
        segments: [
          { appKey: "chrome", appName: "chrome", deviceId: "pc-a", startMs: at(9, 30), endMs: at(10, 0), categoryKey: "study" },
          { appKey: "pycharm", appName: "pycharm", deviceId: "pc-a", startMs: at(11, 10), endMs: at(11, 30), categoryKey: "study" },
        ],
        gaps: [{ startMs: at(11, 0), endMs: at(11, 10) }],
      }),
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["segment", "gap", "segment"]);
  });

  it("内置分类键走本地化表，自由字符串原样显示", () => {
    const uiText = { categories: { game: "游戏" } } as never;
    expect(categoryLabelOf("game", uiText)).toBe("游戏");
    /* 用户自己写的分类名（不是内置键）必须原样出现 —— 落到 other 就等于「分类全错了」。 */
    expect(categoryLabelOf("学习", uiText)).toBe("学习");
    expect(categoryLabelOf("", uiText)).toBe("");
  });

});
