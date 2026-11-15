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
  /* 回值 = 「这次真的接上了吗」。自动链路只在 true 时记「已接管」（高-1） */
  startOrSwitch: vi.fn(async (_itemId: number, _options?: { silent?: boolean }) => true),
  listItemsForApp: vi.fn(async (_params: { appKey: string }) => [] as { itemId: number; appKey: string; track: number }[]),
  timerState: { status: "idle", session: null } as { status: string; session: { itemId: number } | null },
  /* [0.13 R4] 冷启动那条：挂载后主动取一次当前前台（宿主命令 `get_foreground_window`） */
  getForegroundWindow: vi.fn(async () => null as { exeName: string; processId: number } | null),
  /* [0.13] 进程监视注册：本文件载荷不带 process_id，这条永远不该被调（判据见 *Watch.test.ts） */
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
  ipc: { listItemsForApp: h.listItemsForApp, getForegroundWindow: h.getForegroundWindow, setBoundProcessWatch: h.setBoundProcessWatch },
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

/**
 * 冷启动用例专用：卸载后重挂。
 *
 * 为什么必须重挂：主动查询发生在**挂载那一刻**，而 `beforeEach` 已经挂过一次了；
 * 不重挂就只能测到"默认的 null"那条。`mockClear` 只清调用记录（不清 `...Once` 队列），
 * 所以 `toHaveBeenCalledTimes` 数的是这次重挂。
 */
async function remount() {
  act(() => root.unmount());
  h.getForegroundWindow.mockClear();
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
}

beforeEach(() => {
  h.event = "";
  h.handler = null;
  h.startOrSwitch.mockClear();
  h.listItemsForApp.mockClear();
  h.listItemsForApp.mockResolvedValue([]);
  h.getForegroundWindow.mockClear();
  h.getForegroundWindow.mockResolvedValue(null);
  h.setBoundProcessWatch.mockClear();
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
    const rustRel = "../../../../src-tauri/src/models/activity/events.rs";
    const rust = readFileSync(new URL(rustRel, import.meta.url), "utf8");
    expect(rust).toContain('pub const ACTIVE_WINDOW_CHANGED: &str = "active-window-changed"');
  });

  it("ab05_切到有绑定的应用_按归一后的_appKey_查并接管计时", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("  Code  ");

    expect(h.listItemsForApp).toHaveBeenCalledWith({ appKey: "code.exe" });
    /* `silent: true`：用户没点任何东西，失败时不许弹 notice（高-1） */
    expect(h.startOrSwitch).toHaveBeenCalledWith(5, { silent: true });
    /* 载荷没带 `process_id`：接管照常，但注册不了进程监视（判据见 *Watch.test.ts） */
    expect(h.setBoundProcessWatch).not.toHaveBeenCalled();
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
    expect(h.startOrSwitch).toHaveBeenCalledWith(5, { silent: true });
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

  /* [0.13 fix] 用户报的那个 bug 的**真实时序**：先开游戏（那时还没绑）→ 发现没计时 →
   * 打开面板绑上 → 切回同一个游戏。旧实现把「已处理」写在查询**之前**，于是第二次进入
   * 同一个应用被 `lastKeyRef` 挡掉，永远不接管，且没有任何提示。
   * 这条用例咬住的是"未绑定时不许记键"这一条判据 —— 把 `lastKeyRef.current = appKey`
   * 挪回查询之前，它立刻红。 */
  it("ab13_先没绑定后补上绑定_切回同一个应用仍然接管", async () => {
    await activeWindow("yanyun.exe");
    expect(h.startOrSwitch).not.toHaveBeenCalled();

    /* 用户在面板里绑好（宿主侧 item_app 此时才有行） */
    h.listItemsForApp.mockResolvedValue([{ itemId: 12, appKey: "yanyun.exe", track: 1 }]);
    await activeWindow("yanyun.exe");

    expect(h.startOrSwitch).toHaveBeenCalledWith(12, { silent: true });
  });

  /* 接管失败（事项被删 / IPC 报错）同样不许记键：否则一次失败就把这个应用永久排除。
   * [高-1] 走的是**真实失败路径**：`startOrSwitch` 回 `false`（它内部已经把错误吞成
      `silent` 的 notice 抑制 + false），而不是"抛错"这个实际上永远不会发生的情形。 */
  it("ab14_接管失败之后切回同一个应用仍会重试", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.startOrSwitch.mockResolvedValueOnce(false);
    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);

    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledTimes(2);
  });

  /* [产品口径] 点药丸时前台会变成**我们自己**（`timing.exe`），随后点回游戏。
   * 如果那一刻按"离开了应用"处理（清 `handledKeyRef`），用户刚手动切到 C 的计时会被
   * "回到游戏"重新拽回 B —— 用户点自己的药丸不算离开应用。
   * 变异自证：删掉 `if (appKey === SELF_EXE_KEY) return;` → 本用例红（第二次回到
   * code.exe 会又接管一次，`toHaveBeenCalledTimes` 变成 2）。 */
  it("ab15_点药丸（自家进程到前台）不算离开_回到游戏不重新接管", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    await activeWindow("code.exe");
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);

    /* 用户手动把计时切成 C（前台仍在游戏里），接着点药丸 → 前台变成我们自己 */
    await activeWindow("Timing.exe");
    /* 点回游戏 */
    await activeWindow("code.exe");

    /* 没有多接管一次：自家进程那一步既没清 `handledKeyRef`，也没改写 `frontKeyRef` */
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    /* 连绑定都不重查（放行的话这里会是 2 次） */
    expect(h.listItemsForApp).toHaveBeenCalledTimes(1);
  });

  /* [0.13 R4] 冷启动：引擎那次广播早于本组件订阅（开机自启，或先开游戏再开我们），直接丢了；
     之后窗口不再变化就永远不会再发 —— 用户看到「游戏明明在前台，就是不计时」。
     挂载后主动取一次，必须真接管。
     变异自证：删掉 `useEffect` 里那次 `ipc.getForegroundWindow()` → 本用例红（零调用）。 */
  it("ab16_冷启动时游戏已在前台_挂载后主动查一次并接管", async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);
    h.getForegroundWindow.mockResolvedValueOnce({ exeName: "Code.exe", processId: 4242 });
    await remount();

    expect(h.getForegroundWindow).toHaveBeenCalledTimes(1);
    expect(h.listItemsForApp).toHaveBeenCalledWith({ appKey: "code.exe" });
    expect(h.startOrSwitch).toHaveBeenCalledWith(5, { silent: true });
  });

  /* 查不到 / 抛错都等于"不知道"：不接管、不报错、**不 warn**（这条每次启动都跑，噪声会刷屏）。
     变异自证：把 `catch {}` 改成 `catch (e) { console.warn(e) }` → 本用例红； */
  it("ab17_主动查询查不到或抛错_不接管也不报错不刷日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "code.exe", track: 1 }]);

    h.getForegroundWindow.mockResolvedValueOnce(null);
    await remount();
    h.getForegroundWindow.mockRejectedValueOnce(new Error("foreground probe failed"));
    await remount();

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.listItemsForApp).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  /* 冷启动时药丸自己很可能就在前台：主动查询必须和事件那条一样跳过自家进程，
     否则「启动就接管」会在用户没有任何动作的情况下把计时切走。
     变异自证：把 `if (appKey === SELF_EXE_KEY) return;` 挪到 `inFlight` 之后不影响本用例，
     删掉它 → 本用例红（绑了自家进程的脏数据会真接管一次）。 */
  it("ab18_主动查询返回自家进程_不接管", async () => {
    /* 故意给 timing.exe 也绑了事项：证明跳过靠的是自家进程判定，不是"没绑定" */
    h.listItemsForApp.mockResolvedValue([{ itemId: 5, appKey: "timing.exe", track: 1 }]);
    h.getForegroundWindow.mockResolvedValueOnce({ exeName: "timing.exe", processId: 7 });
    await remount();

    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });
});
