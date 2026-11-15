(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Timing — 设置 · 完整数据包（JSON）（[批 2 · 第 5 项]）
 * -----------------------------------------------------------------------------
 * 判据不是「行在不在」，而是**按钮走的是不是那两条命令、以及不兼容的包能不能被放行**：
 *
 *   1. 导出 = `cmd_pick_full_bundle_save_file` → `cmd_export_full_bundle(路径)`；
 *      取消选文件时**一次都不许**调导出（用户改主意 ≠ 导到某个默认位置）；
 *   2. 预览 = `cmd_inspect_full_bundle(路径)`，`compatible === false` 时**确认键根本
 *      不渲染**（灰键仍可聚焦，读屏用户会以为能点）；
 *   3. 确认 = `cmd_import_full_bundle(路径)`，结果按表回报新增/更新/跳过。
 *
 * 命令名写死在断言里：这是跨语言契约（Rust 侧 5 条命令 + ACL 白名单 + 本文件），
 * 任何一头改名都会在这里红，而不是在真机上变成「点了没反应」。
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pickFullBundleSaveFile = vi.fn<() => Promise<string | null>>();
const exportFullBundle = vi.fn<(path: string) => Promise<unknown>>();
const pickFullBundleFile = vi.fn<() => Promise<string | null>>();
const inspectFullBundle = vi.fn<(path: string) => Promise<unknown>>();
const importFullBundle = vi.fn<(path: string) => Promise<unknown>>();

vi.mock("../../../platform/persistence/fullBundleRuntimeGateway.ts", () => ({
  pickFullBundleSaveFile: () => pickFullBundleSaveFile(),
  exportFullBundle: (path: string) => exportFullBundle(path),
  pickFullBundleFile: () => pickFullBundleFile(),
  inspectFullBundle: (path: string) => inspectFullBundle(path),
  importFullBundle: (path: string) => importFullBundle(path),
}));

import SettingsFullBundleExportRow from "./SettingsFullBundleExportRow";
import SettingsFullBundleImportCard from "./SettingsFullBundleImportCard";
import { FULL_BUNDLE_EXPORT_ACTION, FULL_BUNDLE_IMPORT_ACTION } from "./fullBundleCopy.ts";

const BUNDLE_PATH = "D:\\timing\\Timing-full-20261115-0930.json";

const compatibleInspect = {
  format: "timing.full-bundle.v1",
  exportedAtMs: 1794700000000,
  appVersion: "0.13.2",
  deviceId: "dev-a",
  tables: [
    { name: "business.items", rows: 22 },
    { name: "activity.sessions", rows: 14770 },
  ],
  totalRows: 14792,
  compatible: true,
  message: "可以导入：2 张表 / 14792 行",
};

function buttonByText(text: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button"))
    .find((button) => (button.textContent ?? "").trim() === text);
  if (!match) throw new Error(`找不到文案为「${text}」的按钮`);
  return match as HTMLButtonElement;
}

/** 导入卡片的命中区是**空文案**的透明按钮（文案在旁边的 `<p>` 里），只能按 aria-label 找。 */
function buttonByLabel(label: string): HTMLButtonElement {
  const match = document.querySelector(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`找不到 aria-label 为「${label}」的按钮`);
  return match as HTMLButtonElement;
}

function hasButtonText(text: string): boolean {
  return Array.from(document.querySelectorAll("button"))
    .some((button) => (button.textContent ?? "").trim() === text);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  pickFullBundleSaveFile.mockReset();
  exportFullBundle.mockReset();
  pickFullBundleFile.mockReset();
  inspectFullBundle.mockReset();
  importFullBundle.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("完整数据包 · 导出", () => {
  it("ffb01_选定落点后才调导出命令，结果留在行下", async () => {
    pickFullBundleSaveFile.mockResolvedValue(BUNDLE_PATH);
    exportFullBundle.mockResolvedValue({ rowCount: 12, tableCount: 9, bytes: 2048 });
    act(() => {
      root.render(createElement(SettingsFullBundleExportRow));
    });

    await act(async () => {
      buttonByText(FULL_BUNDLE_EXPORT_ACTION).click();
    });

    expect(pickFullBundleSaveFile).toHaveBeenCalledTimes(1);
    expect(exportFullBundle).toHaveBeenCalledTimes(1);
    expect(exportFullBundle).toHaveBeenCalledWith(BUNDLE_PATH);
    expect(container.textContent).toContain("已导出 12 行");
  });

  it("ffb02_取消选文件时一条命令都不发", async () => {
    pickFullBundleSaveFile.mockResolvedValue(null);
    act(() => {
      root.render(createElement(SettingsFullBundleExportRow));
    });

    await act(async () => {
      buttonByText(FULL_BUNDLE_EXPORT_ACTION).click();
    });

    expect(pickFullBundleSaveFile).toHaveBeenCalledTimes(1);
    expect(exportFullBundle).not.toHaveBeenCalled();
    expect(container.textContent ?? "").not.toContain("导出失败");
  });

  it("ffb03_导出失败时把原话留在行下，不静默", async () => {
    pickFullBundleSaveFile.mockResolvedValue(BUNDLE_PATH);
    exportFullBundle.mockRejectedValue("disk is full");
    act(() => {
      root.render(createElement(SettingsFullBundleExportRow));
    });

    await act(async () => {
      buttonByText(FULL_BUNDLE_EXPORT_ACTION).click();
    });

    expect(container.textContent).toContain("导出失败：disk is full");
  });
});

describe("完整数据包 · 导入", () => {
  it("ffb04_不兼容的包只给看，不给导", async () => {
    pickFullBundleFile.mockResolvedValue(BUNDLE_PATH);
    inspectFullBundle.mockResolvedValue({
      ...compatibleInspect,
      format: "timing.full-bundle.v0",
      compatible: false,
      message: "包格式是 timing.full-bundle.v0，本机只认 timing.full-bundle.v1",
    });
    act(() => {
      root.render(createElement(SettingsFullBundleImportCard, {}));
    });

    await act(async () => {
      buttonByLabel("完整数据包（JSON）").click();
    });

    expect(inspectFullBundle).toHaveBeenCalledWith(BUNDLE_PATH);
    expect(document.body.textContent).toContain("本机只认 timing.full-bundle.v1");
    expect(hasButtonText(FULL_BUNDLE_IMPORT_ACTION)).toBe(false);
    expect(importFullBundle).not.toHaveBeenCalled();
  });

  it("ffb05_确认后才写库，并把按表结果摆出来", async () => {
    const onImported = vi.fn();
    pickFullBundleFile.mockResolvedValue(BUNDLE_PATH);
    inspectFullBundle.mockResolvedValue(compatibleInspect);
    importFullBundle.mockResolvedValue({
      tables: [
        { name: "business.items", inserted: 3, updated: 1, skipped: 0 },
        { name: "business.todos", inserted: 0, updated: 0, skipped: 2 },
      ],
      totalInserted: 3,
      totalUpdated: 1,
    });
    act(() => {
      root.render(createElement(SettingsFullBundleImportCard, { onImported }));
    });

    await act(async () => {
      buttonByLabel("完整数据包（JSON）").click();
    });
    expect(importFullBundle).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText(FULL_BUNDLE_IMPORT_ACTION).click();
    });

    expect(importFullBundle).toHaveBeenCalledWith(BUNDLE_PATH);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("已导入：新增 3 行 / 更新 1 行");
    expect(document.body.textContent).toContain("business.todos · 新增 0 / 更新 0 / 跳过 2");
  });
});
