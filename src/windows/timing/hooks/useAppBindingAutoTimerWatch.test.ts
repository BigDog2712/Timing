/**
 * 「自动接管成功后注册进程监视」的判据（[0.13]「应用退出进程才结束」的前端半边）。
 *
 * 主判据文件 `useAppBindingAutoTimer.test.ts` 管接管本身；本文件只管**注册**这一段：
 *
 *   - **注册只来自自动路径**：「已经在计这一件」（可能是用户手动开的计时，甚至是应用
 *     重启前的旧段）不注册 —— 碰了就是越权停掉用户手动计的时（红线①④）。
 *   - **段身份 `(itemId, startedAt)` 从接管成功后的 store 读**：`switch` 的
 *     `end_and_start` 开新段；暂停/继续不改 `started_at`（同一段）。
 *   - **pid 从事件载荷 / 冷启动查询一路带进来**：前端不许自己再查一遍
 *     （进程会退出，晚查到的可能是复用后的新 pid）。
 *   - **注册失败只 warn**：下一次前台变化会重新注册，不影响「已接管」记账。
 *
 * 纯函数（`readActiveWindowProcessId` / `watchInputFromState`）与接线用例放同一文件：
 * 它们咬的是同一条链的两半。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

import { readActiveWindowProcessId } from "../../shared/hostEvents";

const h = vi.hoisted(() => ({
  handler: null as ((payload: unknown) => void) | null,
  event: "",
  startOrSwitch: vi.fn(async (_itemId: number, _options?: { silent?: boolean }) => true),
  listItemsForApp: vi.fn(async (_params: { appKey: string }) => [] as { itemId: number; appKey: string; track: number }[]),
  /* session 带 `startedAt`：注册的段身份就取它 */
  timerState: { status: "idle", session: null } as { status: string; session: { itemId: number; startedAt: number } | null },
  getForegroundWindow: vi.fn(async () => null as { exeName: string; processId: number } | null),
  setBoundProcessWatch: vi.fn(async () => undefined),
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
  ipc: {
    listItemsForApp: h.listItemsForApp,
    getForegroundWindow: h.getForegroundWindow,
    setBoundProcessWatch: h.setBoundProcessWatch,
  },
}));
vi.mock("../stores/timerStore", () => ({
  useTimerStore: { getState: () => ({ state: h.timerState }) },
}));

const { useAppBindingAutoTimer, watchInputFromState } = await import("./useAppBindingAutoTimer");

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

/** 模拟引擎广播一次前台窗口；`processId` 对应载荷的 snake_case `process_id` */
async function activeWindow(exeName: string, processId?: number) {
  await act(async () => {
    h.handler?.(processId === undefined ? { exe_name: exeName } : { exe_name: exeName, process_id: processId });
  });
  await flush();
}

/** 冷启动用例专用：卸载后重挂（主动查询发生在挂载那一刻，见主判据文件 remount 的注释） */
async function remount() {
  act(() => root.unmount());
  h.getForegroundWindow.mockClear();
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
}

/** 接管成功后 store 的样子（`startOrSwitch` 内部 refresh 的替身）：段身份 (5, 1111) */
function takeoverEndsAt(itemId: number, startedAt: number) {
  h.startOrSwitch.mockImplementation(async () => {
    h.timerState = { status: "running", session: { itemId, startedAt } };
    return true;
  });
}

beforeEach(() => {
  h.event = "";
  h.handler = null;
  h.startOrSwitch.mockClear();
  h.startOrSwitch.mockResolvedValue(true);
  h.listItemsForApp.mockClear();
  h.listItemsForApp.mockResolvedValue([]);
  h.getForegroundWindow.mockClear();
  h.getForegroundWindow.mockResolvedValue(null);
  h.setBoundProcessWatch.mockClear();
  h.setBoundProcessWatch.mockResolvedValue(undefined);
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

describe("readActiveWindowProcessId", () => {
  it("bw01_事件载荷是_snake_case_process_id_非法值一律_null", () => {
    expect(readActiveWindowProcessId({ exe_name: "code.exe", process_id: 4242 })).toBe(4242);
    expect(readActiveWindowProcessId({})).toBeNull();
    expect(readActiveWindowProcessId({ process_id: "4242" })).toBeNull();
    expect(readActiveWindowProcessId({ process_id: 0 })).toBeNull();
    expect(readActiveWindowProcessId({ process_id: -1 })).toBeNull();
    expect(readActiveWindowProcessId(null)).toBeNull();
  });

  /* 路径必须走变量（Vite 静态改写字面量 URL，见主判据文件 ab04 的注释） */
  it("bw02_事件载荷字段名对照_Rust_WindowInfo_钉住", () => {
    const rustRel = "../../../../src-tauri/src/infra/activity/windows/foreground.rs";
    const rust = readFileSync(new URL(rustRel, import.meta.url), "utf8");
    expect(rust).toContain("pub struct WindowInfo");
    expect(rust).toContain("pub process_id: u32");
  });
});

describe("watchInputFromState", () => {
  const session = { itemId: 5, startedAt: 1111 };

  it("bw03_会话匹配时三字段逐字成参", () => {
    expect(watchInputFromState(5, 4242, session)).toEqual({
      itemId: 5,
      processId: 4242,
      segmentStartedAt: 1111,
    });
  });

  it("bw04_会话缺失或不匹配一律_null_不许注册别的段", () => {
    expect(watchInputFromState(5, 4242, null)).toBeNull();
    expect(watchInputFromState(9, 4242, session)).toBeNull();
  });

  it("bw05_段起点或_pid_不合法一律_null", () => {
    expect(watchInputFromState(5, 4242, { itemId: 5, startedAt: Number.NaN })).toBeNull();
    expect(watchInputFromState(5, 0, session)).toBeNull();
    expect(watchInputFromState(5, -7, session)).toBeNull();
  });
});

describe("接管成功后注册进程监视", () => {
  /* 变异自证：删掉 hook 里的注册块（`if (watch)` 那三行）→ 本用例红（零调用）；
     把 `segmentStartedAt` 改成 `runningSince` 之类别的字段 → 本用例红（参数逐字不匹配）。 */
  it("bw06_事件带_process_id_接管成功后注册段身份", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    takeoverEndsAt(5, 1111);
    await activeWindow("code.exe", 4242);

    expect(h.startOrSwitch).toHaveBeenCalledWith(5, { silent: true });
    expect(h.setBoundProcessWatch).toHaveBeenCalledTimes(1);
    expect(h.setBoundProcessWatch).toHaveBeenCalledWith({ itemId: 5, processId: 4242, segmentStartedAt: 1111 });
  });

  /* [2026-11-16 口径翻转] 「已在计这一件」**也要注册**：注册表是 Timing 进程内存里的
     临时事实，而计时会话跨进程存活——重启（或恢复对话框续段）之后，这条分支是唯一能
     重建监视的入口。不注册的症状正是主人报的「应用退出了，绑定事项还在计时」。
     段身份取当前 store 的会话；「用户手动切走绝不误停」由 Rust 侧段级校验兜底
     （SegmentMismatch 只清注册表、不碰计时），不再是「不注册」的理由。
     变异自证：把 registerWatch 调用从本分支删掉 → 本用例红（零调用）。 */
  it("bw07_已经在计这一件_不接管但注册监视_重启后存活的会话也能被盯住", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.timerState = { status: "running", session: { itemId: 5, startedAt: 999 } };
    await activeWindow("code.exe", 4242);

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.setBoundProcessWatch).toHaveBeenCalledTimes(1);
    expect(h.setBoundProcessWatch).toHaveBeenCalledWith({ itemId: 5, processId: 4242, segmentStartedAt: 999 });
  });

  /* 变异自证：删掉 `if (processId !== null)` 守卫 → 本用例红（`watchInputFromState`
     收到 null pid 返回 null 时不会再调 ipc —— 所以守卫与纯函数的 pid 三门是双保险，
     删任何一层都要靠本用例或 bw05 抓住）。 */
  it("bw08_载荷没带_process_id_接管照常_但不注册", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    takeoverEndsAt(5, 1111);
    await activeWindow("code.exe");

    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    expect(h.setBoundProcessWatch).not.toHaveBeenCalled();
  });

  it("bw09_接管失败_false_不注册", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.startOrSwitch.mockResolvedValueOnce(false);
    await activeWindow("code.exe", 4242);

    expect(h.setBoundProcessWatch).not.toHaveBeenCalled();
  });

  /* store 里的段不是这次接管的事项（本地乐观刷新的竞态）：宁可少注册，绝不注册错段 */
  it("bw10_接管后会话与事项不一致_不注册", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    takeoverEndsAt(9, 1111);
    await activeWindow("code.exe", 4242);

    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    expect(h.setBoundProcessWatch).not.toHaveBeenCalled();
  });

  /* 注册失败只 warn：下次前台变化重新注册，且不影响「已接管」记账。
     变异自证：把 `console.warn` 那行改成静默吞 → 本用例红（零 warn）；
     让注册失败也清 `handledKeyRef`（或把注册挪到记账之前失败时回滚）→
     本用例红（第二次接管会再发生）。 */
  it("bw11_注册_IPC_失败只warn_不影响已接管记账", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    takeoverEndsAt(5, 1111);
    h.setBoundProcessWatch.mockRejectedValueOnce(new Error("boom"));
    await activeWindow("code.exe", 4242);

    expect(warn).toHaveBeenCalled();
    /* 第二次同应用事件：不重复接管（`handledKeyRef` 没被注册失败波及） */
    await activeWindow("code.exe", 4242);
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /* 冷启动那条也带 pid（`ForegroundWindow.processId`，camelCase —— 与事件的
     snake_case `process_id` 是两个形状，`readActiveWindowProcessId` 只管事件）。 */
  it("bw12_冷启动带_processId_接管后注册", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    takeoverEndsAt(5, 2222);
    h.getForegroundWindow.mockResolvedValueOnce({ exeName: "Code.exe", processId: 4242 });
    await remount();

    expect(h.getForegroundWindow).toHaveBeenCalledTimes(1);
    expect(h.setBoundProcessWatch).toHaveBeenCalledWith({ itemId: 5, processId: 4242, segmentStartedAt: 2222 });
  });
});
