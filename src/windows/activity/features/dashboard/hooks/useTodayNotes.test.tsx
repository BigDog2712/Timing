(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 便利贴「删了就删了」的判据（[本轮] 便利贴可删除）。
 *
 * 为什么这条必须测：删除走的是**事件桥**，宿主落库有一小段延迟，而刷新是 30s 一次。
 * 少了"待消失"集合，用户会看到「删了又蹦回来」—— 界面不报错、日志也不报错，
 * 唯一的表现是"这功能好像没生效"。反过来，集合只加不清会让那张贴**永远**不再出现
 * （宿主真删掉了，本地却还在过滤它），所以两条边界都要钉：
 *   ① 删完立刻从清单里消失；
 *   ② 后续刷新结果里若还带着它 → 继续过滤（不复发）；
 *   ③ 刷新结果里已经没有它 → 把它从集合里摘掉（此后不再过滤，别的贴照常出现）。
 */
const g = vi.hoisted(() => ({
  listNoteSummaries: vi.fn(),
}));

vi.mock("../../../platform/persistence/noteReadRepository.ts", () => ({
  listNoteSummaries: g.listNoteSummaries,
}));

import { useTodayNotes, type TodayNotesState } from "./useTodayNotes.ts";
import type { NoteSummary } from "../../../shared/types/notes.ts";

function note(id: number, updatedAt: number): NoteSummary {
  return { id, itemId: null, content: `note ${id}`, createdAt: updatedAt, updatedAt };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: TodayNotesState | null = null;

function Probe({ refreshKey }: { refreshKey: number }) {
  latest = useTodayNotes(refreshKey);
  return null;
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

async function mount(refreshKey = 0): Promise<void> {
  await act(async () => { root?.render(createElement(Probe, { refreshKey })); });
  await flush();
}

async function bump(refreshKey: number): Promise<void> {
  await act(async () => { root?.render(createElement(Probe, { refreshKey })); });
  await flush();
}

function ids(): number[] {
  return (latest?.notes ?? []).map((row) => row.id);
}

beforeEach(() => {
  g.listNoteSummaries.mockReset();
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

describe("useTodayNotes · 删除后的本地收敛", () => {
  it("n03_remove_local_drops_the_note_immediately", async () => {
    g.listNoteSummaries.mockResolvedValue([note(1, 300), note(2, 200), note(3, 100)]);
    await mount();
    expect(ids()).toEqual([1, 2, 3]);

    act(() => { latest?.removeLocal(2); });

    /* 立刻消失：不等 30s 刷新，也不等宿主回执 */
    expect(ids()).toEqual([1, 3]);
    expect(latest?.total).toBe(2);
  });

  it("n04_a_stale_refresh_that_still_returns_the_deleted_note_does_not_resurrect_it", async () => {
    g.listNoteSummaries.mockResolvedValue([note(1, 300), note(2, 200)]);
    await mount();

    act(() => { latest?.removeLocal(2); });
    /* 宿主还没落库：下一次刷新"原样"返回了那张贴（这正是删除后 1~2 秒内的真实情况） */
    g.listNoteSummaries.mockResolvedValue([note(1, 300), note(2, 200)]);
    await bump(1);

    expect(ids()).toEqual([1]);
  });

  it("n05_once_the_host_stops_returning_it_the_filter_is_lifted", async () => {
    g.listNoteSummaries.mockResolvedValue([note(1, 300), note(2, 200)]);
    await mount();
    act(() => { latest?.removeLocal(2); });

    /* 宿主真删掉了：结果里不再有 2 */
    g.listNoteSummaries.mockResolvedValue([note(1, 300)]);
    await bump(1);
    expect(ids()).toEqual([1]);

    /* 此后新建的一张 id 恰好也是 2（SQLite 复用 rowid 是可能的）：集合已摘掉 → 必须照常出现。
       这一条就是"只加不清"那个 bug 的探针。 */
    g.listNoteSummaries.mockResolvedValue([note(1, 300), note(2, 400)]);
    await bump(2);
    expect(ids()).toEqual([2, 1]);
  });

  it("n06_status_never_falls_back_to_loading_after_data_arrived", async () => {
    g.listNoteSummaries.mockResolvedValue([note(1, 300)]);
    await mount();
    expect(latest?.status).toBe("ready");

    /* 刷新期（promise 还没 resolve）里 status 必须仍是 ready：退回 loading 会让整条通栏
       换成骨架，每次切前台闪一次 */
    let release: (rows: NoteSummary[]) => void = () => undefined;
    g.listNoteSummaries.mockImplementation(() => new Promise<NoteSummary[]>((resolve) => { release = resolve; }));
    await act(async () => { root?.render(createElement(Probe, { refreshKey: 1 })); });
    expect(latest?.status).toBe("ready");

    await act(async () => { release([note(1, 300)]); });
    await flush();
    expect(latest?.status).toBe("ready");
  });
});
