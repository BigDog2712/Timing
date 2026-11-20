(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「今日时间线」**卡壳**（0.12.6）—— 原 `ItemsCard.test.tsx` 的结构判据搬到这里。
 *
 * 这一层只管**装配**（上区待办 / 分隔线 / 下区记录），三条都"改错了也照样好看"：
 *   ① 分隔线是**卡的直接子节点**，不在任何一个区里 —— 挂进区里就会跟着那一区滚，
 *      于是"滚待办时横线跑到下半屏"。这是 P1-1 的原症状，所以判 `parentElement`
 *      与 `closest("[data-zone]") === null`，而不是判它存在；
 *   ② 两区顺序固定「待办在上、时间线在下」（`data-zone` 出现顺序）；
 *   ③ 总计只在事项源 `ready` 时给数：loading 的数还没有、error 的数不可信，
 *      这两种状态下宁可空着也不要把 0 或上一轮残留当"今天一共"。
 *      两区的空态文案也必须**不一样** —— 同一句"今天还没有……"会让用户分不清
 *      是"没有待办"还是"没有计时记录"。
 */
const h = vi.hoisted(() => ({
  getItemTimeline: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("../../../platform/persistence/attributionGateway.ts", () => ({
  getItemTimeline: h.getItemTimeline,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import TimelineTodosCard from "./TimelineTodosCard.tsx";

const COPY = DASHBOARD_COPY["zh-CN"];
const TITLE = "今日时间线";
const TOTAL = 80 * 60_000;

const ROWS: TodayItemRow[] = [
  {
    itemId: 11,
    name: "写周报",
    color: "",
    value: TOTAL,
    firstStart: Date.now() - 3_600_000,
    lastEnd: null,
    segments: 2,
  },
];

/** 待办源的空实现：这一册只判卡壳，待办行为在 `TodosModule.test.tsx` 等册子里 */
function todosModel(status: LoadStatus = "ready"): TodayTodosState {
  return {
    todos: [],
    status,
    pending: null,
    create: async () => false,
    toggle: () => undefined,
    remove: () => undefined,
    createBatch: async () => false,
    update: async () => false,
    undoPending: () => undefined,
    retry: () => undefined,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

interface MountOptions {
  title?: string;
  rows?: TodayItemRow[];
  total?: number;
  status?: LoadStatus;
  todosStatus?: LoadStatus;
}

async function mount(over: MountOptions = {}) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimelineTodosCard, {
        title: over.title ?? TITLE,
        todayItems: {
          rows: over.rows ?? ROWS,
          total: over.total ?? TOTAL,
          status: over.status ?? "ready",
          retry: () => undefined,
        },
        todosModel: todosModel(over.todosStatus ?? "ready"),
        refreshError: false,
      }),
    }));
  });
  await flush();
}

const card = () => container?.querySelector<HTMLElement>("section.at-card-items") ?? null;
const zones = () =>
  Array.from(card()?.querySelectorAll<HTMLElement>("[data-zone]") ?? [])
    .map((zone) => zone.getAttribute("data-zone"));
const zoneOf = (name: string) => card()?.querySelector<HTMLElement>(`[data-zone="${name}"]`) ?? null;

beforeEach(() => {
  h.getItemTimeline.mockReset();
  h.getItemTimeline.mockResolvedValue([]);
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

describe("今日时间线卡 · 卡壳结构", () => {
  it("tc01_the_card_head_shows_the_title_given_by_props", async () => {
    await mount({ title: "我的一天" });
    expect(card()?.querySelector(".at-card-title")?.textContent).toBe("我的一天");
  });

  it("tc02_the_separator_is_a_direct_child_of_the_card_and_not_inside_any_zone", async () => {
    await mount();
    const separator = card()?.querySelector<HTMLElement>('[role="separator"]');
    expect(separator, "找不到那条贯穿卡宽的分隔线").not.toBeNull();
    /* P1-1：分隔线必须**不随任何一区滚动** —— 所以判父节点是卡本身、且不在区里 */
    expect(separator?.parentElement, "分隔线被挪进了别的容器（会跟着那一区滚）").toBe(card());
    expect(separator?.closest("[data-zone]"), "分隔线挂在某个区里了").toBeNull();
    /* 无障碍文案要说清"分隔的是什么"，不能只是一个空 div */
    expect(separator?.getAttribute("aria-label")).toBe(COPY.itemsDividerLabel);
  });

  it("tc03_the_timeline_zone_sits_above_and_the_todos_zone_below", async () => {
    await mount();
    expect(zones()).toEqual(["timeline", "todos"]);
    /* 两区各在自己的包裹层里（`.at-card-items__upper` / `__lower`）：顺序判据之外，
       还要判它们确实分居分隔线两侧，否则"上面是时间线"只是数组顺序的巧合 */
    expect(card()?.querySelector(".at-card-items__upper [data-zone='timeline']")).not.toBeNull();
    expect(card()?.querySelector(".at-card-items__lower [data-zone='todos']")).not.toBeNull();
    const separator = card()?.querySelector('[role="separator"]');
    expect(separator?.previousElementSibling?.hasAttribute("data-zone")).toBe(false);
    expect(separator?.nextElementSibling?.hasAttribute("data-zone")).toBe(false);
  });
});

describe("今日时间线卡 · 总计只在 ready 时给数", () => {
  it("tc04_a_ready_source_shows_the_backend_total_in_the_zone_head", async () => {
    await mount();
    expect(card()?.querySelector(".at-card-meta")?.textContent)
      .toBe(COPY.timelineTotal(formatDashboardDuration(TOTAL)));
  });

  it("tc05_loading_and_error_show_no_total_at_all", async () => {
    /* loading 的数还没有、error 的数不可信：这两种状态下"总计 0"是一句假话 */
    await mount({ status: "loading" });
    expect(card()?.querySelector(".at-card-meta"), "loading 时就给了总计").toBeNull();
    await mount({ status: "error" });
    expect(card()?.querySelector(".at-card-meta"), "读失败时给了总计").toBeNull();
  });
});

describe("今日时间线卡 · 两区的四态各自独立", () => {
  it("tc06_both_zones_empty_but_each_says_its_own_thing", async () => {
    await mount({ rows: [] });
    const todosEmpty = zoneOf("todos")?.querySelector(".at-empty")?.textContent;
    const timelineEmpty = zoneOf("timeline")?.querySelector(".at-empty")?.textContent;
    expect(todosEmpty).toBe(COPY.todosEmpty);
    expect(timelineEmpty).toBe(COPY.itemsTimelineEmpty);
    /* 同一句文案会让用户分不清"没有待办"还是"没有计时记录" */
    expect(todosEmpty).not.toBe(timelineEmpty);
  });

  it("tc07_each_zone_has_its_own_skeleton_shape", async () => {
    /* 两区的 loading 是各自的骨架（待办 5 条读数 / 记录 3 行）：块数不同才说明
       "哪一区在等哪一条数据"，共用一个骨架就会让两区同时亮起来像一整块在加载 */
    await mount({ rows: [], status: "loading", todosStatus: "loading" });
    const todosSpans = zoneOf("todos")?.querySelectorAll(".at-skeleton span").length;
    const timelineSpans = zoneOf("timeline")?.querySelectorAll(".at-skeleton span").length;
    expect(todosSpans).toBeGreaterThan(0);
    expect(timelineSpans).toBeGreaterThan(0);
    expect(todosSpans).not.toBe(timelineSpans);
    /* loading 时两区都不该有列表 */
    expect(zoneOf("todos")?.querySelector(".at-todo-list")).toBeNull();
    expect(zoneOf("timeline")?.querySelector(".at-timeline-rows")).toBeNull();
  });
});
