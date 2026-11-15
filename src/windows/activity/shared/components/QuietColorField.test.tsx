/**
 * QuietColorField 弹出调色盘的「出口」（[0.13] 主人反馈：选完颜色没有确认键，
 * 只能靠"点外面"或按 Esc 才能收起来）。
 *
 * 钉三件事：
 *   ① head 里有一颗 `dialog.confirm` 的确认键 —— 不是"再点触发键"这种隐式路径；
 *   ② 点它之后调色盘从 DOM 里消失（portal 到 body，所以要按 document 查）；
 *   ③ 焦点回到触发键 —— 收起后焦点留在 body 上，键盘用户下一次按 Tab 会从头开始。
 *
 * 手法与仓库其它 UI 测试一致：`react-dom/client` + `act`（仓库未装 @testing-library），
 * 颜色控件内部读 i18n 文案，所以必须包一层真实 `LocaleProvider`；源码语言就是 zh-CN，
 * `loadLocaleText('zh-CN')` 不触网。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import QuietColorField from "./QuietColorField";
import { LocaleProvider } from "../i18n/index.ts";
import { loadLocaleText } from "../i18n/runtime.ts";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await loadLocaleText("zh-CN");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function mount(): Promise<void> {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    /* children 写在 props 里：`createElement(P, props, child)` 的第三参数形式 tsc 不认 */
    root.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(QuietColorField, {
        color: "#70FFFF",
        format: "hex" as const,
        onChange: vi.fn(),
        onFormatChange: vi.fn(),
      }),
    }));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function trigger(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(".at-color-trigger");
  if (!el) throw new Error("找不到颜色触发键");
  return el;
}

function popover(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".at-color-popover");
}

function doneButton(): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.getAttribute("aria-label") === "确认");
  if (!el) throw new Error("调色盘里找不到确认键");
  return el;
}

describe("QuietColorField · 调色盘出口", () => {
  it("cf01_调色盘里有一颗确认键_点了就收起并把焦点还给触发键", async () => {
    await mount();
    expect(popover()).toBeNull();

    await act(async () => { trigger().click(); });
    expect(popover()).not.toBeNull();

    await act(async () => { doneButton().click(); });
    expect(popover()).toBeNull();
    /* 焦点回触发键：不等 rAF 就只能验到"没收起"，所以这里让出一帧 */
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(trigger());
  });

  it("cf02_再点一次触发键依旧能打开_确认键不是把控件锁死", async () => {
    await mount();
    await act(async () => { trigger().click(); });
    await act(async () => { doneButton().click(); });
    await act(async () => { trigger().click(); });
    expect(popover()).not.toBeNull();
    /* 打开后确认键必须还在（上一次收起不该把它卸载掉） */
    expect(doneButton()).toBeTruthy();
  });
});
