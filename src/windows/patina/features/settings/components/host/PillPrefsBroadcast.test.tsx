/**
 * 设置页写「悬浮条偏好」的判据（[0.12.1 修复 → 0.12.1 归一：真源搬到设置表]）
 * -----------------------------------------------------------------------------
 * 0.12.1 的判据是「写完 localStorage 之后广播了什么载荷」；0.12.1 归一之后真源是宿主设置表，
 * 载荷不再携带值，所以口径换成**三条更硬的**：
 *
 *  1. 改常驻形态 → 先 `savePillPrefs({ appearance: 完整三项 })`，**成功之后**才
 *     `nudgePillPrefs()`，界面与本地缓存才更新；
 *  2. 改手柄开关 → 同上，载荷是**归一化后**的整份三形态绑定；
 *  3. 面板挂载 → 去真源**读**一次（`loadPillPrefs`），**不写库**（用户只是打开设置页，
 *     不该产生写入）。
 *
 * 为什么顺序要单独钉：先改界面后落库的话，写失败时界面在撒谎（用户以为存上了，
 * 关掉设置页再进来就变回去了）。b04 直接把这条钉住。
 *
 * 变异自证（本轮必做）：把 `SettingsHandlesPanel.commit` 里的 `await savePillPrefs(...)`
 * 整句删掉、只留写本地缓存 —— b02 立刻红（`savePillPrefs` 没被调用）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../../shared/pillPrefsGateway", () => ({
  loadPillPrefs: vi.fn(async () => null),
  savePillPrefs: vi.fn(async () => undefined),
  nudgePillPrefs: vi.fn(),
}));

import {
  loadPillPrefs,
  nudgePillPrefs,
  savePillPrefs,
} from "../../../../../shared/pillPrefsGateway";
import { DEFAULT_HANDLE_BINDINGS } from "../../../../../shared/handleCatalog";
import type { PillPrefs } from "../../../../../shared/pillAppearance";
import SettingsHandlesPanel from "../SettingsHandlesPanel";
import HostPillLookCard from "./HostPillLookCard";

const loadMock = vi.mocked(loadPillPrefs);
const saveMock = vi.mocked(savePillPrefs);
const nudgeMock = vi.mocked(nudgePillPrefs);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  loadMock.mockReset();
  loadMock.mockResolvedValue(null);
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined);
  nudgeMock.mockReset();
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

async function mount(node: Parameters<Root["render"]>[0]) {
  await act(async () => root?.render(node));
}

async function clickByText(text: string): Promise<HTMLButtonElement> {
  const hit = Array.from(container!.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === text,
  );
  if (!hit) throw new Error(`找不到按钮「${text}」`);
  await act(async () => {
    hit.click();
  });
  return hit;
}

/** 一份完整合法快照（槽位值取自动作目录的出厂绑定）。 */
function snapshot(overrides: Partial<PillPrefs["appearance"]> = {}): PillPrefs {
  return {
    appearance: { textOpacity: 1, bgOpacity: 1, floatForm: "bar", ...overrides },
    handles: {
      dot: { enabled: DEFAULT_HANDLE_BINDINGS.dot.enabled, slots: { ...DEFAULT_HANDLE_BINDINGS.dot.slots } },
      half: { enabled: DEFAULT_HANDLE_BINDINGS.half.enabled, slots: { ...DEFAULT_HANDLE_BINDINGS.half.slots } },
      full: { enabled: DEFAULT_HANDLE_BINDINGS.full.enabled, slots: { ...DEFAULT_HANDLE_BINDINGS.full.slots } },
    },
  };
}

describe("设置页 → 悬浮条 的偏好搬运", () => {
  it("b01_changing_float_form_broadcasts_the_persisted_value", async () => {
    await mount(createElement(HostPillLookCard));
    const button = await clickByText("小圆点");

    /* ① 走真源：整份三项（不是用户点的那一个键）—— Rust 侧要做「读旧 → 覆盖 → 写全量」，
       只发一个键就等于要求后端猜另外两个。 */
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0]).toEqual({
      appearance: { textOpacity: 1, bgOpacity: 1, floatForm: "dot" },
    });

    /* ② 先落库、后发声（顺序反了就是「界面先变、库可能没变」） */
    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(nudgeMock.mock.invocationCallOrder[0]);

    /* ③ 落库成功之后界面才更新，本地缓存也才写（首帧缓存，不是真源） */
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("timing.appearance.v1")).toContain('"dot"');
  });

  it("b02_toggling_a_handle_broadcasts_the_normalized_bindings", async () => {
    await mount(createElement(SettingsHandlesPanel));
    const switches = Array.from(container!.querySelectorAll('[role="switch"]'));
    expect(switches.length, "手柄开关数量不是 3 个形态").toBe(3);

    await act(async () => {
      (switches[0] as HTMLButtonElement).click();
    });

    const payload = saveMock.mock.calls[0][0];
    const handles = payload.handles;
    expect(handles, "没有把 handles 发给宿主").toBeTruthy();
    expect(handles?.dot.enabled).toBe(true);
    /* 归一化后的形状：三个形态都在，且不带 `version`（那是 localStorage 那份的外壳） */
    expect(Object.keys(handles ?? {}).sort()).toEqual(["dot", "full", "half"]);
    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(nudgeMock.mock.invocationCallOrder[0]);
    expect(localStorage.getItem("timing.handles.v1")).toContain('"dot"');
  });

  it("b03_mounting_a_panel_pushes_the_value_that_only_this_window_has", async () => {
    /* 用例名沿用 0.12.1（那时是「把本窗独有的值推出去」）；归一之后的口径反过来了 ——
       进门**读真源**，让界面显示库里的值，并且**不许写库**（用户只是打开设置页）。 */
    loadMock.mockResolvedValue(snapshot({ textOpacity: 0.6, bgOpacity: 0.8, floatForm: "dot" }));

    await mount(createElement(HostPillLookCard));
    await act(async () => undefined);

    expect(loadMock).toHaveBeenCalled();
    expect(saveMock, "挂载不该产生任何写入").not.toHaveBeenCalled();
    expect(nudgeMock, "挂载不该发信号").not.toHaveBeenCalled();
    /* 真源的值落到了本窗缓存（下次冷启动首帧就对） */
    const cached = localStorage.getItem("timing.appearance.v1");
    expect(cached).toContain('"dot"');
    expect(cached).toContain('"textOpacity":0.6');
  });

  it("b04_failed_save_keeps_the_ui_and_shows_a_red_line", async () => {
    saveMock.mockRejectedValue(new Error("数据保存失败，已保留在本地"));
    await mount(createElement(SettingsHandlesPanel));

    const switches = Array.from(container!.querySelectorAll('[role="switch"]'));
    await act(async () => {
      (switches[0] as HTMLButtonElement).click();
    });

    /* 写失败：界面不许改（否则界面在撒谎）、不发信号、卡内显示红字 */
    expect(nudgeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("timing.handles.v1")).toBeNull();
    const alert = container!.querySelector(".inline-error");
    expect(alert?.textContent).toContain("数据保存失败");
  });
});
