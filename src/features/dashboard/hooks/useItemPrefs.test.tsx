(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「事项管理」数据层 `useItemPrefs` 的判据（[QA 独立补测]）。
 *
 * 为什么必须单独测：`TimelineManage*` 两个弹层测试走的是**渲染层**，它们只能证明
 * "点完看起来变了"；真正会静默出错的是这张**待确认表**（`pendingItemsRef` /
 * `pendingTimersRef`）—— 写意图没有回执，宿主落库到下一次刷新之间有窗口期：
 *   · 刷新回来还是旧值 → 必须用本地值覆盖（否则用户看到"改完又弹回去"）；
 *   · 刷新回来与本地一致 → 必须**摘掉**待确认（否则本地旧值会永远盖住宿主真值，
 *     用户之后在药丸里改的同一事项永远看不到 —— 这就是 `useTodayItems` i03 同款 bug）。
 *
 * 另外钉两条"看起来能跑其实错"的地方：
 *   · 时长清除必须**整体重建** timers 对象（就地 `Object.assign` 会把该删的键留下，
 *     症状是"默认时长清不掉"）；
 *   · `get_settings` 失败只降级（清单照常、条数回默认），不能把整卡打成错误态。
 */
interface Item {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
  isPinned: boolean;
  sortOrder: number;
  updatedAt: number;
}

const g = vi.hoisted(() => ({
  listTimingItems: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: g.listTimingItems,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({
  getSettings: g.getSettings,
}));

import { readPrefsSettings, useItemPrefs, type ItemPrefsState } from "./useItemPrefs.ts";
import { itemTimerMinutes } from "../services/itemPrefs.ts";

const item = (id: number, name: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  color: "",
  isSystem: false,
  isPinned: false,
  sortOrder: 0,
  updatedAt: 0,
  ...over,
});

const settings = (over: Record<string, unknown> = {}) => ({
  itemsTimers: {},
  itemsRecentCount: 5,
  itemsShowRecent: true,
  ...over,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ItemPrefsState | null = null;

function Probe() {
  latest = useItemPrefs(true);
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
  g.listTimingItems.mockReset();
  g.getSettings.mockReset();
  g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
  g.getSettings.mockResolvedValue(settings());
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

describe("useItemPrefs · 待确认事项", () => {
  it("up01_a_stale_refresh_does_not_undo_the_local_unpin", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount();
    expect(latest?.items[0]?.isPinned).toBe(true);

    act(() => { latest?.applyLocalItem(2, { isPinned: false }); });
    expect(latest?.items[0]?.isPinned).toBe(false);

    /* 宿主还没落库：下一次刷新原样返回 isPinned:true（这正是取消常用后 1~2 秒的真实情况） */
    act(() => { latest?.reload(); });
    await flush();

    expect(latest?.items[0]?.isPinned).toBe(false);
  });

  it("up02_once_the_host_agrees_the_pending_entry_is_dropped", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount();
    act(() => { latest?.applyLocalItem(2, { isPinned: false }); });

    /* 宿主落库了 */
    g.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: false, sortOrder: 1 })]);
    act(() => { latest?.reload(); });
    await flush();
    expect(latest?.items[0]?.isPinned).toBe(false);

    /* 此后药丸里把它重新设成常用 —— 待确认表若没摘掉，本地旧值会**永远**盖住真值 */
    g.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    act(() => { latest?.reload(); });
    await flush();
    expect(latest?.items[0]?.isPinned).toBe(true);
  });
});

describe("useItemPrefs · 默认时长", () => {
  it("up03_clearing_a_timer_rebuilds_the_map_so_the_key_really_disappears", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    g.getSettings.mockResolvedValue(settings({ itemsTimers: { "2": 25 } }));
    await mount();
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBe(25);

    act(() => { latest?.applyLocalTimer(2, null); });
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBeNull();

    /* 宿主还没落库，刷新回来仍是 25 —— 本地必须保持"清掉"（就地 merge 会把这个键留下） */
    act(() => { latest?.reload(); });
    await flush();
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBeNull();
    expect(Object.keys(latest?.timers ?? {})).toEqual([]);

    /* 宿主落库了（这个键真的没了）→ 待确认摘掉 */
    g.getSettings.mockResolvedValue(settings());
    act(() => { latest?.reload(); });
    await flush();
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBeNull();

    /* 此后药丸里给它设成 10 —— 待确认若没摘掉，本地"已清除"会**永远**盖住宿主真值 */
    g.getSettings.mockResolvedValue(settings({ itemsTimers: { "2": 10 } }));
    act(() => { latest?.reload(); });
    await flush();
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBe(10);
  });

  /* 这条钉的是**已知取舍**（别当成 bug 顺手"修"掉）：清时长的意图发失败时，宿主仍是旧值，
     本地的"已清除"会一直赢下去 —— 与 `useTodayItems.pendingRenamesRef` 同款纪律
     （本地乐观值优先，直到宿主值与之一致）。代价是界面上"清不掉"（要等下次改成功或重启）。 */
  it("up03b_a_failed_clear_keeps_winning_until_the_host_agrees", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    g.getSettings.mockResolvedValue(settings({ itemsTimers: { "2": 25 } }));
    await mount();

    act(() => { latest?.applyLocalTimer(2, null); });
    /* 清除意图没落库：宿主一直是 25，另一处（药丸）又把它改成 10 */
    g.getSettings.mockResolvedValue(settings({ itemsTimers: { "2": 10 } }));
    act(() => { latest?.reload(); });
    await flush();

    /* 本地仍显示"无默认时长"（乐观值优先），而不是宿主的 10 */
    expect(itemTimerMinutes(latest?.timers ?? {}, 2)).toBeNull();
  });
});

describe("useItemPrefs · 降级与脏设置", () => {
  it("up04_readPrefsSettings_falls_back_on_dirty_values", () => {
    expect(readPrefsSettings(null)).toEqual({ timers: {}, recentCount: 5, showRecent: true });
    expect(readPrefsSettings({})).toEqual({ timers: {}, recentCount: 5, showRecent: true });
    /* 条数脏值钳到 1..10；非法时长被丢弃 */
    expect(readPrefsSettings({ itemsRecentCount: 99, itemsTimers: { "2": 0, "3": 30 } }))
      .toEqual({ timers: { "3": 30 }, recentCount: 10, showRecent: true });
    /* 只认显式 false */
    expect(readPrefsSettings({ itemsShowRecent: false }).showRecent).toBe(false);
    expect(readPrefsSettings({ itemsShowRecent: "false" }).showRecent).toBe(true);
  });

  it("up05_a_settings_read_failure_degrades_instead_of_breaking_the_list", async () => {
    g.getSettings.mockRejectedValue(new Error("SETTINGS_FAILED"));
    await mount();

    expect(latest?.status).toBe("ready");
    expect(latest?.items).toHaveLength(1);
    expect(latest?.timers).toEqual({});
    expect(latest?.recentCount).toBe(5);
    expect(latest?.showRecent).toBe(true);
  });

  it("up06_an_items_read_failure_is_reported_as_error_not_as_an_empty_list", async () => {
    g.listTimingItems.mockRejectedValue(new Error("LIST_ITEMS_FAILED"));
    await mount();

    expect(latest?.status).toBe("error");
    expect(latest?.items).toEqual([]);
  });
});
