(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 事项「改了名就一直是新名字」的判据（[本轮] 时间线卡「事项管理」弹层的行内编辑）。
 *
 * 为什么必须单独测：改名走的是**事件桥**，没有回执；宿主落库有一小段延迟，而刷新是
 * 30s 一次（`useTodayItems` 的 `setInterval`）。少了"待确认"表，用户会看到「改完又
 * 变回去」—— 界面不报错、日志也不报错，唯一的表现是"这功能好像没生效"。
 *
 * 与便利贴的删除**不是同一套**：删除是本地的"过滤掉"，改名是"覆盖回去"。所以三条边界
 * 都要钉，而且第三条最容易写错：
 *   ① 改完立刻生效（不等刷新、不等回执）；
 *   ② 刷新结果里还是旧名字 → 继续用本地名字覆盖（不弹回去）；
 *   ③ 刷新结果里已经是新名字 → 把 id 从待确认表里摘掉，**此后不再覆盖**。
 *      ③ 的反面就是那个隐藏 bug：只加不清 → 用户第二次在别处改名永远看不到
 *      （本地那条旧名字会一直盖住宿主的真实值）。
 */
const g = vi.hoisted(() => ({
  listTimingItems: vi.fn(),
  listTimingRecords: vi.fn(),
}));

vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: g.listTimingItems,
  listTimingRecords: g.listTimingRecords,
}));

import { buildTodayItemRows, useTodayItems, type TodayItemsState } from "./useTodayItems.ts";
import type { TimingItem, TimingRecord } from "../../../platform/persistence/timingReadRepository.ts";

function item(id: number, name: string, isSystem = false): TimingItem {
  /* [本轮] `list_items` 现在也透传 isPinned / sortOrder / updatedAt（「事项管理」要用） */
  return { id, name, color: "", isSystem, isPinned: false, sortOrder: 0, updatedAt: 0 };
}

/** 今天刚发生的一段记录：`startedAt` 落在今天，`accumulatedSec` 给一个正数。 */
function record(id: number, itemId: number, minutes: number): TimingRecord {
  return {
    id,
    itemId,
    startedAt: Date.now() - 5 * 60 * 1000 - id,
    endedAt: Date.now() - 4 * 60 * 1000,
    accumulatedSec: minutes * 60,
    status: "saved",
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: TodayItemsState | null = null;

function Probe({ refreshKey }: { refreshKey: number }) {
  latest = useTodayItems(refreshKey, 60);
  return null;
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

async function mount(): Promise<void> {
  await act(async () => { root?.render(createElement(Probe, { refreshKey: 0 })); });
  await flush();
}

async function bump(refreshKey: number): Promise<void> {
  await act(async () => { root?.render(createElement(Probe, { refreshKey })); });
  await flush();
}

function names(): string[] {
  return (latest?.rows ?? []).map((row) => row.name);
}

beforeEach(() => {
  g.listTimingItems.mockReset();
  g.listTimingRecords.mockReset();
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

describe("useTodayItems · 改名后的本地收敛", () => {
  it("i01_apply_local_rename_renames_the_row_immediately", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码"), item(3, "开会")]);
    g.listTimingRecords.mockResolvedValue([record(1, 2, 30), record(2, 3, 10)]);
    await mount();
    expect(names()).toEqual(["写代码", "开会"]);

    act(() => { latest?.applyLocalRename(2, "写代码（重构）"); });

    /* 立刻生效：不等 30s 刷新，也不等宿主回执 */
    expect(names()).toEqual(["写代码（重构）", "开会"]);
  });

  it("i02_a_stale_refresh_that_still_returns_the_old_name_does_not_undo_the_rename", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    g.listTimingRecords.mockResolvedValue([record(1, 2, 30)]);
    await mount();

    act(() => { latest?.applyLocalRename(2, "写代码（重构）"); });
    /* 宿主还没落库：下一次刷新"原样"返回旧名字（这正是改名后 1~2 秒内的真实情况） */
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    await bump(1);

    expect(names()).toEqual(["写代码（重构）"]);
  });

  it("i03_once_the_host_returns_the_new_name_the_override_is_lifted", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    g.listTimingRecords.mockResolvedValue([record(1, 2, 30)]);
    await mount();
    act(() => { latest?.applyLocalRename(2, "写代码（重构）"); });

    /* 宿主落库了：返回新名字 → 待确认表摘掉这条 */
    g.listTimingItems.mockResolvedValue([item(2, "写代码（重构）")]);
    await bump(1);
    expect(names()).toEqual(["写代码（重构）"]);

    /* 此后若是**别处**（药丸的事项菜单）又改了名，宿主返回的是那个值 —— 必须照常显示。
       这一条就是"只加不清"那个 bug 的探针：不摘表的话，本地旧名字会永远盖住真实值。 */
    g.listTimingItems.mockResolvedValue([item(2, "写代码（第二版）")]);
    await bump(2);
    expect(names()).toEqual(["写代码（第二版）"]);
  });

  it("i04_apply_local_create_does_not_add_a_timeline_row", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码")]);
    g.listTimingRecords.mockResolvedValue([record(1, 2, 30)]);
    await mount();
    expect(names()).toEqual(["写代码"]);

    /* 新建的事项今天还没有记录 → 时间线不该多出一行（这张卡只画今天有记录的事项），
       但它必须触发一次重取，好让「事项管理」弹层能拿到真实 id。 */
    const before = g.listTimingItems.mock.calls.length;
    g.listTimingItems.mockResolvedValue([item(2, "写代码"), item(9, "看论文")]);
    await act(async () => { latest?.applyLocalCreate("看论文"); });
    await flush();

    expect(g.listTimingItems.mock.calls.length).toBeGreaterThan(before);
    expect(names()).toEqual(["写代码"]);
  });

  it("i05_renaming_one_row_does_not_touch_the_others", async () => {
    g.listTimingItems.mockResolvedValue([item(2, "写代码"), item(3, "开会"), item(4, "看论文")]);
    g.listTimingRecords.mockResolvedValue([record(1, 2, 30), record(2, 3, 20), record(3, 4, 10)]);
    await mount();

    act(() => { latest?.applyLocalRename(3, "开会（周会）"); });

    expect(names()).toEqual(["写代码", "开会（周会）", "看论文"]);
  });
});

/* ── [0.13 · 1.6] 行的「止」列与总计口径（纯函数直测） ──
 * 变异靶子 ④：「时间线总计不来自后端口径 → 判据红」。后端口径 = `accumulated_sec`
 * 之和（Rust 已按 ADR-030 重算），**不是** `(ended - started)` 的前端减法 ——
 * 暂停过的记录两者不相等，减法会把暂停时间也计入。 */
describe("buildTodayItemRows · lastEnd 与总计的后端口径", () => {
  const from = new Date(2026, 10, 11, 0, 0, 0).getTime();
  const to = from + 24 * 60 * 60 * 1000;

  it("i06_last_end_is_the_max_ended_at_and_null_while_running", () => {
    const dayStart = from;
    const rows = buildTodayItemRows([item(2, "写代码")], [
      { id: 1, itemId: 2, startedAt: dayStart + 9 * 3600_000, endedAt: dayStart + 10 * 3600_000, accumulatedSec: 3600, status: "saved" },
      { id: 2, itemId: 2, startedAt: dayStart + 11 * 3600_000, endedAt: dayStart + 12 * 3600_000, accumulatedSec: 3600, status: "saved" },
    ], from, to, from + 12 * 3600_000);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastEnd).toBe(dayStart + 12 * 3600_000);
  });

  it("i07_a_running_record_makes_last_end_null_even_after_saved_ones", () => {
    const dayStart = from;
    const rows = buildTodayItemRows([item(2, "写代码")], [
      { id: 1, itemId: 2, startedAt: dayStart + 9 * 3600_000, endedAt: dayStart + 10 * 3600_000, accumulatedSec: 3600, status: "saved" },
      { id: 2, itemId: 2, startedAt: dayStart + 14 * 3600_000, endedAt: null, accumulatedSec: 600, status: "active" },
    ], from, to, dayStart + 14 * 3600_000 + 5 * 60_000);
    expect(rows[0].lastEnd).toBeNull();
  });

  it("i08_total_follows_accumulated_sec_not_the_timestamp_subtraction", () => {
    const dayStart = from;
    /* 暂停过的记录：accumulated_sec = 10 分钟，但 end - start = 20 分钟。
       前端口径（错误实现）会得 20 分钟；后端口径（accumulated_sec）得 10 分钟。 */
    const rows = buildTodayItemRows([item(2, "写代码")], [
      { id: 1, itemId: 2, startedAt: dayStart + 9 * 3600_000, endedAt: dayStart + 11 * 3600_000, accumulatedSec: 600, status: "saved" },
    ], from, to, dayStart + 11 * 3600_000);
    expect(rows[0].value).toBe(600_000);
    /* useTodayItems 的 total = Σ row.value（useMemo），同一口径的镜像断言 */
    const sum = rows.reduce((acc, row) => acc + row.value, 0);
    expect(sum).toBe(600_000);
  });
});
