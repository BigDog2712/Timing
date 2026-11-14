/**
 * 「切到绑定了事项的应用就自动接管计时」的判据（[0.13] 主人口径）。
 *
 * 这条链有三段，任何一段断了都是**静默**的（切过去什么都不发生，没有报错）：
 *   ① 事件名与载荷字段对不上 Rust 的广播 → 永远收不到（source test 钉住）；
 *   ② `app_key` 归一口径漂了 → 绑定查不到（`appKey.test.ts` 钉住）；
 *   ③ 查到绑定之后该不该切换的判断错了 → 要么不切，要么反复把用户的计时拽回来。
 * 本文件管 ①③。
 *
 * 判据刻意钉"不动作"的那几种情形：自动行为最怕的不是没生效，而是**乱生效**
 * （用户在手动计别的事项，被一次窗口切换强行打断）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  handler: null as ((payload: unknown) => void) | null,
  event: "",
  startOrSwitch: vi.fn(async (_itemId: number) => undefined),
  listItemsForApp: vi.fn(async (_params: { appKey: string }) => [] as { itemId: number; appKey: string; track: number }[]),
  timerState: { status: "idle", session: null } as { status: string; session: { itemId: number } | null },
}));

vi.mock("./useTauriEvent", () => ({
  useTauriEvent: (event: string, handler: (payload: unknown) => void) => {
    h.event = event;
    h.handler = handler;
  },
}));
vi.mock("./useTimerActions", () => ({
  useTimerActions: () => ({ startOrSwitch: h.startOrSwitch }),
}));
vi.mock("../services/ipc", () => ({
  ipc: { listItemsForApp: h.listItemsForApp },
}));
vi.mock("../stores/timerStore", () => ({
  useTimerStore: { getState: () => ({ state: h.timerState }) },
}));

const { pickBoundItemId, useAppBindingAutoTimer } = await import("./useAppBindingAutoTimer");

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useAppBindingAutoTimer();
  return null;
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** 模拟引擎广播一次前台窗口（载荷是 `RawTrackingWindowSnapshot`，这里只带用到的字段） */
async function activeWindow(exeName: string) {
  await act(async () => { h.handler?.({ exe_name: exeName }); });
  await flush();
}

beforeEach(() => {
  h.event = "";
  h.handler = null;
  h.startOrSwitch.mockClear();
  h.listItemsForApp.mockClear();
  h.listItemsForApp.mockResolvedValue([]);
  h.timerState = { status: "idle", session: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("pickBoundItemId", () => {
  it("ab01_只认_track_为_1_的绑定_多条取最小_itemId", () => {
    expect(pickBoundItemId([
      { itemId: 9, track: 1 },
      { itemId: 4, track: 1 },
      { itemId: 2, track: 0 },
    ])).toBe(4);
  });

  it("ab02_track_缺省按_计入_处理_没有绑定时返回_null", () => {
    expect(pickBoundItemId([{ itemId: 7 }])).toBe(7);
    expect(pickBoundItemId([])).toBeNull();
    expect(pickBoundItemId([{ itemId: 7, track: 0 }])).toBeNull();
  });

  it("ab03_脏_id_被丢掉_不参与挑选", () => {
    expect(pickBoundItemId([{ itemId: 0, track: 1 }, { itemId: -3, track: 1 }, { itemId: 5, track: 1 }])).toBe(5);
  });
});

describe("useAppBindingAutoTimer", () => {
  it("ab04_订阅的是_Rust_那份事件名_snake_case_payload", () => {
    expect(h.event).toBe("active-window-changed");
    /* 路径必须走变量：`new URL("字面量", import.meta.url)` 会被 Vite 静态改写成 http 地址，
       而 jsdom 里 `readFileSync` 只认 file 协议（报 "The URL must be of scheme file"）。 */
    const rustRel = "../../../../src-tauri/src/models/insight/events.rs";
    const rust = readFileSync(new URL(rustRel, import.meta.url), "utf8");
    expect(rust).toContain('pub const ACTIVE_WINDOW_CHANGED: &str = "active-window-changed"');
  });

  it("ab05_切到有绑定的应用_按归一后的_appKey_查并接管计时", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("  Code  ");

    expect(h.listItemsForApp).toHaveBeenCalledWith({ appKey: "code.exe" });
    expect(h.startOrSwitch).toHaveBeenCalledWith(5);
  });

  it("ab06_没有绑定的应用_一个动作都不做", async () => {
    await activeWindow("explorer.exe");
    expect(h.listItemsForApp).toHaveBeenCalledWith({ appKey: "explorer.exe" });
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it("ab07_同一个应用第二次进入前台不重复接管_避免把用户手动切走的计时拽回来", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("code.exe");
    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    /* 第二次连查都不查（宁可少查一次也别白打 IPC） */
    expect(h.listItemsForApp).toHaveBeenCalledTimes(1);
  });

  it("ab08_离开再回来会再次接管_中间那次是别的应用", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("code.exe");
    h.listItemsForApp.mockResolvedValue([]);
    await activeWindow("explorer.exe");
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledTimes(2);
  });

  it("ab09_已经在计这个事项时不再调用_不做无意义的切换", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.timerState = { status: "running", session: { itemId: 5 } };
    await activeWindow("code.exe");
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it("ab10_正在计别的事项时仍然切换_这正是需求要的结束当前并开始绑定事项", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.timerState = { status: "running", session: { itemId: 9 } };
    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledWith(5);
  });

  it("ab11_查询失败只吞掉_不抛给用户也不重复打扰", async () => {
    h.listItemsForApp.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await activeWindow("code.exe");
    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ab12_没有_exe_name_的脏载荷直接跳过", async () => {
    await act(async () => { h.handler?.({}); });
    await flush();
    expect(h.listItemsForApp).not.toHaveBeenCalled();
  });
});
