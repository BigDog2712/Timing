(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UiText } from "../../../shared/i18n/index.ts";
import { buildHistoryRangeDays } from "../services/historyRange.ts";
import { buildHistoryRangeAggregate } from "../services/historyRangeAggregate.ts";
import { buildDeviceLanes } from "../services/deviceLanes.ts";
import { HISTORY_RANGE_COPY } from "../rangeCopy.ts";
import HistoryRangeView from "./HistoryRangeView.tsx";
import type { HistoryRangeDataState } from "../hooks/useHistoryRangeData.ts";

/**
 * 「单设备时 DOM 里不出现任何设备元素」——**做成断言，不靠目测**。
 *
 * 为什么非要进 DOM 断言：样式/结构的"没画出来"是最容易被后人改回去的一类东西
 * （删掉一个 `deviceLanes.length > 0` 条件、或者把图例改成恒渲染），而它不会让任何
 * 数字变红。这里钉三条：`device-lane` 数 = 0、`device-chip` 数 = 0、`device-legend` 为 null；
 * 多设备时反过来，且**本机在第一行**。
 */
const COPY = HISTORY_RANGE_COPY["zh-CN"];
const UI_TEXT = {
  common: { retry: "重试", refreshFailed: "刷新失败，显示上次成功结果。" },
  date: { today: "今天", yesterday: "昨天" },
} as unknown as UiText;

const DAY = new Date(2026, 10, 10, 0, 0, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const SELF_ID = "b265fafdc306";
const PHONE_ID = "a1b2c3d4e5f6";

function aggregateWith(timelineSessions: Array<{ deviceId?: string }>) {
  return buildHistoryRangeAggregate({
    days: buildHistoryRangeDays("2026-11-10", "2026-11-10", DAY + 20 * HOUR),
    sessions: [{ exeName: "code.exe", appName: "VS Code", startMs: DAY + HOUR, endMs: DAY + 3 * HOUR }],
    timelineSessions: timelineSessions.map((session, index) => ({
      exeName: "code.exe",
      appName: "VS Code",
      startMs: DAY + HOUR + index * 10 * 60_000,
      endMs: DAY + 2 * HOUR + index * 10 * 60_000,
      deviceId: session.deviceId,
    })),
    records: [],
    items: [],
    notes: [],
    todos: [],
    unnamedItemLabel: "未命名计时",
    deviceOrder: buildDeviceLanes(timelineSessions, SELF_ID).map((lane) => lane.deviceId),
  });
}

let container: HTMLDivElement;
let root: Root;

function render(state: HistoryRangeDataState): void {
  act(() => {
    root.render(createElement(HistoryRangeView, {
      copy: COPY,
      uiText: UI_TEXT,
      locale: "zh-CN" as const,
      data: state,
      onOpenDay: vi.fn(),
    }));
  });
}

function stateWith(timelineSessions: Array<{ deviceId?: string }>): HistoryRangeDataState {
  return {
    aggregate: aggregateWith(timelineSessions),
    deviceLanes: buildDeviceLanes(timelineSessions, SELF_ID),
    loading: false,
    error: false,
    retry: vi.fn(),
    resolvedRange: null,
  };
}

function all(selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("单设备：界面里一个设备元素都不许有", () => {
  it("没有 device-lane、没有 chip、没有图例，且每天仍是一条带子", () => {
    render(stateWith([{ deviceId: SELF_ID }]));
    expect(all('[data-testid="device-lane"]').length).toBe(0);
    expect(all('[data-testid="device-chip"]').length).toBe(0);
    expect(container.querySelector('[data-testid="device-legend"]')).toBeNull();
    expect(all("[data-history-range-timeline-day]").length).toBe(1);
    /* 「本机」这两个字也不该出现在页面上（它不是被隐藏，是压根没渲染） */
    expect(container.textContent ?? "").not.toContain(COPY.selfDevice);
  });

  it("会话完全没有 deviceId（旧快照）时同样零设备元素", () => {
    render(stateWith([{}]));
    expect(all('[data-testid="device-lane"]').length).toBe(0);
    expect(container.querySelector('[data-testid="device-legend"]')).toBeNull();
  });
});

describe("多设备：按设备分行、本机在第一行", () => {
  it("device-lane 数 = 设备数，本机排第一", () => {
    render(stateWith([{ deviceId: PHONE_ID }, { deviceId: SELF_ID }]));
    const lanes = all('[data-testid="device-lane"]');
    expect(lanes.length).toBe(2);
    expect(lanes[0].dataset.deviceId).toBe(SELF_ID);
    expect(lanes[1].dataset.deviceId).toBe(PHONE_ID);
  });

  it("图例出现且本机在第一项，chip 与泳道同数", () => {
    render(stateWith([{ deviceId: PHONE_ID }, { deviceId: SELF_ID }]));
    const legend = container.querySelector('[data-testid="device-legend"]');
    expect(legend).not.toBeNull();
    const items = all('[data-testid="device-legend-item"]');
    expect(items.map((item) => item.dataset.deviceId)).toEqual([SELF_ID, PHONE_ID]);
    expect(all('[data-testid="device-chip"]').length).toBe(2);
  });

  it("本机那一栏写「本机」，另一台写短 id（不写整串 12 位）", () => {
    render(stateWith([{ deviceId: PHONE_ID }, { deviceId: SELF_ID }]));
    const text = container.textContent ?? "";
    expect(text).toContain(COPY.selfDevice);
    expect(text).toContain(PHONE_ID.slice(0, 6));
    expect(text).not.toContain(PHONE_ID);
  });
});
