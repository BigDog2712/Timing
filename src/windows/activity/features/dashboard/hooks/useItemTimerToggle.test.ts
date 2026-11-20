(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 合并卡上区行点击起停的**方向判据**（0.12.6 · T4 · PRD P0-5）。
 *
 * 这里钉的是四件"错了也不报错"的事：
 *   ① 方向在**发信侧**判：同一个事项正在跑 → `stop_timer`；其余一律 `start_timer_for_item`；
 *   ② 暂停中的同一事项**不发** `stop_timer`（那是"继续"，`startOrSwitch` 会接住）；
 *   ③ 连点只发一条（`busyRef`），且宿主侧 `startOrSwitch` 对同一事项幂等 —— 两条都不能少；
 *   ④ 提示只在**宿主确认之后**出：点完不响，等那一帧 `timer:state-changed` 对上了才响。
 *
 * 为什么④要单独钉：如果点击就提示"已开始计时"，而药丸实际拒绝了（比如事项刚被删），
 * 用户会看到一句成功提示 + 一个没开始计时 —— 分析窗不承诺结果（§6.5）这条纪律就是这么丢的。
 */
const h = vi.hoisted(() => ({
  readSnapshot: vi.fn(async (): Promise<unknown> => null),
  /* 形参有名字只为让 `mockImplementation` 能接住订阅回调（类型上必须声明它） */
  subscribe: vi.fn(async (_callback: (value: unknown) => void): Promise<unknown> => null),
  emit: vi.fn(async (_intent: unknown): Promise<boolean> => true),
}));

vi.mock("../../../platform/runtime/hostTimerGateway.ts", () => ({
  readHostTimerSnapshot: h.readSnapshot,
  subscribeHostTimerState: h.subscribe,
}));
vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emit }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import { useItemTimerToggle, type ItemTimerToggle } from "./useItemTimerToggle.ts";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ItemTimerToggle | null = null;
let broadcast: ((snapshot: unknown) => void) | null = null;
let toasts: string[] = [];
const pushToast = (message: string): void => {
  toasts.push(message);
};

function snapshot(status: string, itemId: number | null) {
  return {
    status,
    session: status === "idle" || itemId === null
      ? null
      : { id: 1, itemId, accumulatedSec: 0, runningSince: status === "running" ? 1_000 : null },
    lastItemId: itemId,
    liveDurationSec: 0,
    mode: "countup",
    remainingSec: null,
  };
}

function Probe() {
  latest = useItemTimerToggle(pushToast);
  return null;
}

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(initial: unknown = null) {
  await resolveLocaleActivation("zh-CN", () => true);
  h.readSnapshot.mockResolvedValue(initial);
  h.subscribe.mockImplementation(async (callback: (value: unknown) => void) => {
    broadcast = callback;
    return () => undefined;
  });
  act(() => {
    root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: createElement(Probe) }));
  });
  await flush();
}

beforeEach(() => {
  h.readSnapshot.mockReset();
  h.subscribe.mockReset();
  h.emit.mockReset();
  h.emit.mockResolvedValue(true);
  toasts = [];
  latest = null;
  broadcast = null;
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

describe("行点击起停 · 方向（P0-5）", () => {
  it("tt01_idle_starts_the_clicked_item", async () => {
    await mount(snapshot("idle", null));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(h.emit).toHaveBeenCalledWith({ action: "start_timer_for_item", itemId: 7 });
  });

  it("tt02_running_the_same_item_stops_it", async () => {
    await mount(snapshot("running", 7));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(h.emit).toHaveBeenCalledWith({ action: "stop_timer" });
  });

  it("tt03_running_another_item_switches_instead_of_stopping", async () => {
    await mount(snapshot("running", 3));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    /* 正在计 3，点 7 = 切过去；**不能**发 stop（那会把 3 结束掉） */
    expect(h.emit).toHaveBeenCalledWith({ action: "start_timer_for_item", itemId: 7 });
    expect(h.emit).not.toHaveBeenCalledWith({ action: "stop_timer" });
  });

  it("tt04_a_paused_session_on_the_same_item_resumes_rather_than_stops", async () => {
    await mount(snapshot("paused", 7));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(h.emit).toHaveBeenCalledWith({ action: "start_timer_for_item", itemId: 7 });
  });

  it("tt05_a_double_click_sends_only_one_intent", async () => {
    await mount(snapshot("idle", null));
    let release: ((value: boolean) => void) | null = null;
    h.emit.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve; }));
    act(() => latest?.toggleItem(7, "写周报"));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1);
    await act(async () => { release?.(true); await Promise.resolve(); });
  });
});

describe("提示只在宿主确认之后出（§6.5）", () => {
  it("tt06_start_is_announced_only_after_the_broadcast", async () => {
    await mount(snapshot("idle", null));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(toasts).toEqual([]);

    await act(async () => { broadcast?.(snapshot("running", 7)); await Promise.resolve(); });
    expect(toasts).toEqual(["已开始计时：写周报"]);
  });

  it("tt07_stop_is_announced_when_the_session_leaves_the_item", async () => {
    await mount(snapshot("running", 7));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();

    await act(async () => { broadcast?.(snapshot("idle", null)); await Promise.resolve(); });
    expect(toasts).toEqual(["已结束计时：写周报"]);
  });

  it("tt08_a_transition_that_does_not_match_stays_silent", async () => {
    await mount(snapshot("idle", null));
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();

    /* 药丸没照做（例如事项刚被删）：广播里跑起来的是别的事项 —— 不编一句"已开始计时" */
    await act(async () => { broadcast?.(snapshot("running", 3)); await Promise.resolve(); });
    expect(toasts).toEqual([]);
  });

  it("tt09_a_broken_bridge_says_so_instead_of_pretending", async () => {
    await mount(snapshot("idle", null));
    h.emit.mockResolvedValue(false);
    act(() => latest?.toggleItem(7, "写周报"));
    await flush();
    expect(toasts).toEqual(["没通知到计时器，再点一次"]);
  });
});
