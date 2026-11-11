/**
 * 设置页 → 悬浮条的偏好搬运判据（[0.12.1 修复]）
 * -----------------------------------------------------------------------------
 * 守的是这条事故链的最后一环：主界面（patina）与悬浮条（main）**不在同一个 WebView
 * 数据目录**，localStorage 是两份互不相干的存储。设置页写完自己那份之后如果**不广播**，
 * 用户回到悬浮条看到的还是旧值 —— 症状「设置里怎么调都没反应」，零报错、零日志。
 *
 * 所以三个断言都盯着「写完之后到底发出去了什么」：
 *  1. 改常驻形态 → `emit('timing:pill-prefs', { appearance })`，且带的是**落盘后**的值；
 *  2. 改手柄开关 → 同一个事件、`{ handles }`，且带的是**归一化后**的绑定；
 *  3. 面板挂载 → 各自推一次当前值（用户 0.12.1 里调好的值只存在本窗，进一次设置页要对齐）。
 *
 * 变异自证：把任一 `broadcast*` 调用删掉，对应用例立刻红；把 payload 从 `saved` 改成
 * `next`（未归一化的入参），第 1 与第 2 条都会红。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

import { emit } from "@tauri-apps/api/event";
import { PILL_PREFS_EVENT } from "../../../../lib/pillAppearance";
import type { Appearance, PillPrefsPayload } from "../../../../lib/pillAppearance";
import SettingsHandlesPanel from "../SettingsHandlesPanel";
import HostPillLookCard from "./HostPillLookCard";

const emitMock = vi.mocked(emit);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  emitMock.mockClear();
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

function mount(node: Parameters<Root["render"]>[0]) {
  act(() => root?.render(node));
}

function clickByText(text: string): HTMLButtonElement {
  const hit = Array.from(container!.querySelectorAll("button"))
    .find((node) => node.textContent?.trim() === text);
  if (!hit) throw new Error(`找不到按钮「${text}」`);
  act(() => {
    hit.click();
  });
  return hit;
}

/** 取最后一次广播的载荷（一次操作可能因为挂载对齐再加一次，只关心最后一次） */
function lastPayload(): PillPrefsPayload {
  const calls = emitMock.mock.calls.filter(([name]) => name === PILL_PREFS_EVENT);
  expect(calls.length, "没有发出任何偏好广播").toBeGreaterThan(0);
  return calls[calls.length - 1][1] as PillPrefsPayload;
}

describe("设置页 → 悬浮条 的偏好搬运", () => {
  it("b01_changing_float_form_broadcasts_the_persisted_value", () => {
    mount(createElement(HostPillLookCard));
    clickByText("小圆点");

    const payload = lastPayload();
    const appearance = payload.appearance as Appearance | undefined;
    expect(appearance, "广播里没有 appearance").toBeTruthy();
    expect(appearance?.floatForm).toBe("dot");
    /* 带的是**落盘后**的完整三项，不是用户点的那一个键：
       悬浮条那边要直接覆盖自己那份，缺字段会被读成默认值。 */
    expect(Object.keys(appearance ?? {}).sort()).toEqual(["bgOpacity", "floatForm", "textOpacity"]);
    expect(localStorage.getItem("timing.appearance.v1")).toContain('"dot"');
  });

  it("b02_toggling_a_handle_broadcasts_the_normalized_bindings", () => {
    mount(createElement(SettingsHandlesPanel));
    const switches = Array.from(container!.querySelectorAll('[role="switch"]'));
    expect(switches.length, "手柄开关数量不是 3 个形态").toBe(3);

    act(() => {
      (switches[0] as HTMLButtonElement).click();
    });

    const payload = lastPayload();
    const handles = payload.handles as Record<string, { enabled: boolean }> | undefined;
    expect(handles, "广播里没有 handles").toBeTruthy();
    expect(handles?.dot?.enabled).toBe(true);
    /* 归一化后的形状：三个形态都在，且不带 `version`（那是存储层的外壳） */
    expect(Object.keys(handles ?? {}).sort()).toEqual(["dot", "full", "half"]);
  });

  it("b03_mounting_a_panel_pushes_the_value_that_only_this_window_has", () => {
    /* 用户在 0.12.1 里调过、但当时没有通道送达悬浮条 —— 这个值只存在本窗 */
    localStorage.setItem(
      "timing.appearance.v1",
      JSON.stringify({ textOpacity: 0.6, bgOpacity: 0.8, floatForm: "dot" }),
    );
    mount(createElement(HostPillLookCard));

    const appearance = lastPayload().appearance as Appearance | undefined;
    expect(appearance?.textOpacity).toBe(0.6);
    expect(appearance?.floatForm).toBe("dot");
  });
});
