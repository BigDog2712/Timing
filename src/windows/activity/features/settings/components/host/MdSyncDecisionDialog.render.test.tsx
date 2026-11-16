/**
 * md 覆盖提醒弹窗（T03）· 渲染级判据
 * -----------------------------------------------------------------------------
 * 为什么必须真挂一次：这个组件**没有一行可见的界面单测覆盖**——它只在「文件侧被改过」
 * 时出现，正常路径永远碰不到。而它的失效形态全是静默的：
 *   · 事件名或载荷形状改了 → 弹窗永不出现（用户以为冲突已经自动处理了，其实两端各写各的）；
 *   · 三个按钮的 `Decision` 词汇串写错（如 `overwrite`）→ 后端 serde 解析失败，
 *     用户点了「覆盖 Timing」得到一条红字，而 md 与库都没动；
 *   · `pending_decision` 没被过滤 → 后台挂起的冲突在前台又弹一遍，用户被反复打扰。
 * 所以这里断言的是**词汇串**与**调用参数**，不是「有个弹窗」。
 *
 * 两条数据源各验一次：`md_sync_decisions()` 回捞（挂载时）与
 * `md-sync:decision-required` 事件（前台同步后）。前者漏了 = 关掉弹窗就再也找不回。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = vi.hoisted(() => ({
  decisions: vi.fn(),
  resolve: vi.fn(),
  handler: null as null | ((payload: unknown) => void),
}));

vi.mock("../../services/hostApi", () => ({
  mdSyncApi: { decisions: g.decisions, resolve: g.resolve },
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../services/host/hostEvents", () => ({
  MD_SYNC_DECISION_REQUIRED_EVENT: "md-sync:decision-required",
  useHostEvent: (_event: string, handler: (payload: unknown) => void) => {
    g.handler = handler;
  },
}));

import { MdSyncDecisionDialog } from "./MdSyncDecisionDialog";

type Conflict = {
  id: string;
  kind: "timers" | "notes" | "todos" | "app_usage" | "items";
  heading: string;
  path: string;
  date: string;
  state: "awaiting_decision" | "pending_decision";
};

function conflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "timers|C:\\vault|{date}.md|#### 事项计时",
    kind: "timers",
    heading: "#### 事项计时",
    path: "C:\\vault\\2026-11-16.md",
    date: "2026-11-16",
    state: "awaiting_decision",
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  g.decisions.mockReset().mockResolvedValue([]);
  g.resolve.mockReset().mockResolvedValue({ imported: 0, exported: false, direction: "pending" });
  g.handler = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/** 弹窗走 portal 挂在 body 上，`container` 里看不到——必须查 body。 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(MdSyncDecisionDialog));
  });
  /* 挂载时那一次 `decisions()` 的 promise 要落定，界面才是最终态。 */
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return document.body.textContent ?? "";
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
}

function clickButton(label: string): void {
  const target = buttons().find((button) => (button.textContent ?? "").trim() === label);
  if (!target) throw new Error(`没有找到按钮「${label}」，当前有：${buttons().map((b) => b.textContent).join(" / ")}`);
  act(() => target.click());
}

describe("d · md 覆盖提醒弹窗", () => {
  it("d01_mount_backfills_awaiting_conflicts_and_ignores_pending", async () => {
    g.decisions.mockResolvedValue([
      conflict(),
      conflict({ id: "notes|...", kind: "notes", heading: "#### 便利贴", state: "pending_decision" }),
    ]);
    await mount();

    expect(text()).toContain("Markdown 与 Timing 内容不一致");
    expect(text()).toContain("#### 事项计时");
    expect(text(), "落点类型要翻成中文标签，不是 `timers`").toContain("事项计时");
    expect(text()).toContain("C:\\vault\\2026-11-16.md");
    /* 后台挂起的不得进弹窗：它还需要用户主动触发一次前台同步才会被提升。 */
    expect(text(), "pending_decision 不该弹窗").not.toContain("#### 便利贴");
  });

  it("d02_three_buttons_carry_the_exact_decision_vocabulary", async () => {
    g.decisions.mockResolvedValue([conflict()]);
    await mount();

    const labels = buttons().map((button) => (button.textContent ?? "").trim());
    expect(labels).toEqual(["覆盖 Timing", "保留 Timing", "暂不处理"]);
  });

  it("d03_overwrite_sends_overwrite_timing_and_drops_the_row", async () => {
    g.decisions.mockResolvedValue([conflict()]);
    await mount();

    clickButton("覆盖 Timing");
    await act(async () => {
      await Promise.resolve();
    });

    expect(g.resolve).toHaveBeenCalledTimes(1);
    expect(g.resolve.mock.calls[0][0]).toBe(conflict().id);
    expect(
      g.resolve.mock.calls[0][1],
      "词汇串必须与 Rust `Decision::as_str()` 逐字一致（overwrite_timing）",
    ).toBe("overwrite_timing");
    expect(text(), "裁决完的行要立刻消失，否则用户会对着已处理的冲突再点一次").not.toContain(
      "#### 事项计时",
    );
  });

  it("d04_deferred_sends_deferred_not_keep_or_overwrite", async () => {
    g.decisions.mockResolvedValue([conflict()]);
    await mount();

    clickButton("暂不处理");
    await act(async () => {
      await Promise.resolve();
    });

    expect(g.resolve.mock.calls[0][1], "暂不处理是 deferred，不能混成保留").toBe("deferred");
    expect(text()).not.toContain("#### 事项计时");
  });

  it("d05_resolve_failure_keeps_the_row_and_shows_raw_text", async () => {
    g.resolve.mockRejectedValue(new Error("MD_SYNC_CONFIG_INVALID：该冲突已处理或不再存在"));
    g.decisions.mockResolvedValue([conflict()]);
    await mount();

    clickButton("保留 Timing");
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      text(),
      "失败口不许润色：错误码与原因都要原本出现在界面上",
    ).toContain("MD_SYNC_CONFIG_INVALID");
    expect(text(), "没处理成功就不能把行去掉").toContain("#### 事项计时");
  });

  it("d06_event_payload_opens_the_dialog", async () => {
    await mount();
    expect(text(), "挂载时没有冲突 ⇒ 不弹窗").not.toContain("Markdown 与 Timing 内容不一致");

    act(() => {
      g.handler?.([conflict({ heading: "#### 待办事项", kind: "todos" })]);
    });

    expect(text()).toContain("#### 待办事项");
    expect(text()).toContain("待办事项");
  });
});
