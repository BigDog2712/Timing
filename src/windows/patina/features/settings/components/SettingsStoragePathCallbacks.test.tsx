(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsStoragePathsGroup from "./SettingsStoragePathsGroup";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";
import type { CleanupRange } from "../types";

/**
 * [QA 补测] 「本机目录」三个目录行与清理档位滑杆的**回调接线**。
 *
 * 已经有的用例只核了渲染与禁用态（`qd02` / `qd04` / `qd05` / `qd07`），**没有一条**按下去
 * 看它调的是哪个回调、带的是哪个路径 —— 而这正是本轮拆分最容易掉的东西：
 *   · 三个目录行都是同一个 `StoragePathRow`，把 `dataRoot` 传给「安装目录」那行不会红；
 *   · 「更改目录」与「恢复默认目录」是**二选一**渲染的，绑反了也不会有渲染差异；
 *   · 档位滑杆的档位是 `cleanupOptions` 排序后的下标，不是硬编码的 enum。
 */
const snapshot: StorageSnapshot = {
  paths: {
    installDir: "C:\\Apps\\Timing",
    timingDataRoot: "C:\\Users\\me\\AppData\\com.timing.app",
    dataRoot: "C:\\Users\\me\\AppData\\Timing",
    databasePath: "C:\\Users\\me\\AppData\\Timing\\timing.db",
    backupDir: "C:\\Users\\me\\AppData\\Timing\\backups",
    remoteBackupTempDir: "C:\\Users\\me\\AppData\\Timing\\tmp",
    webviewRoot: "C:\\Users\\me\\AppData\\Timing\\webview",
    isCustomDataRoot: false,
    isCustomWebviewRoot: false,
  },
  sizes: { installDirSizeBytes: 1048576, dataSizeBytes: 524288, timingDataSizeBytes: 2097152, backupDirSizeBytes: 0 },
  webviewCache: {
    webviewRoot: "C:\\Users\\me\\AppData\\Timing\\webview",
    ebwebviewPath: "C:\\Users\\me\\AppData\\Timing\\webview\\EBWebView",
    totalSizeBytes: 1024,
    reclaimableSizeBytes: 0,
    lastTrimAtMs: null,
    entries: [],
  },
  maintenance: { lastError: null },
};


let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await resolveLocaleActivation("zh-CN", () => true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function mountPaths(overrides: Partial<Parameters<typeof SettingsStoragePathsGroup>[0]> = {}): void {
  const cb = {
    onRefreshStorageSnapshot: vi.fn(),
    onChooseCacheDirectory: vi.fn(),
    onRestoreDefaultCacheDirectory: vi.fn(),
    onOpenStorageDirectory: vi.fn(),
  };
  act(() => {
    root.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(SettingsStoragePathsGroup, {
        storageSnapshot: snapshot,
        isStorageBusy: false,
        busy: false,
        ...cb,
        ...overrides,
      }),
    }));
  });
  Object.assign(mounted, cb);
}

const mounted: Record<string, ReturnType<typeof vi.fn>> = {};

/** 某一行的标题文字 → 它的右侧控件区里的键（按 aria-label 取） */
function rowKey(titlePart: string, labelPart: string): HTMLButtonElement | null {
  const row = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"))
    .find((node) => (node.querySelector(".settings-preference-title")?.textContent ?? "").includes(titlePart));
  return Array.from(row?.querySelectorAll<HTMLButtonElement>(".settings-preference-control button") ?? [])
    .find((button) => (button.getAttribute("aria-label") ?? "").includes(labelPart)) ?? null;
}

describe("本机目录：三个目录行的回调各接各的", () => {
  it("spc01_each_open_key_passes_its_own_directory", () => {
    mountPaths();
    act(() => { rowKey("安装目录", "打开目录")?.click(); });
    act(() => { rowKey("缓存目录", "打开目录")?.click(); });
    act(() => { rowKey("数据目录", "打开目录")?.click(); });
    const opened = mounted.onOpenStorageDirectory.mock.calls.map((call) => call[0]);
    expect(opened, `打开目录带出去的路径不对：${opened.join(" | ")}`).toEqual([
      snapshot.paths.installDir,
      /* 缓存目录要的是 EBWebView 那一层，不是 webviewRoot —— 打开到上一级等于没打开 */
      snapshot.webviewCache?.ebwebviewPath,
      /* 数据目录要的是**数据根**（`timingDataRoot`），不是活动库那一层 `dataRoot`：
         「我的数据都在哪」的答案里有 timing.db / md / logs / plugins / patina。 */
      snapshot.paths.timingDataRoot,
    ]);
  });

  /**
   * [设置页七项改造·批 6] 数据目录行不再挂「更改 / 恢复默认」两个键。
   *
   * 原因不是样式：那两个键走的是 `cmd_*_storage_migration`（只搬 `patina/data` 那一层），
   * 而这一行显示的是整个数据根（`%APPDATA%\com.timing.app`）—— 键一点下去，搬走的
   * 与用户看到的不是同一个目录。搬根只有一处入口：同步里的「SQLite 落点设置」。
   * 所以这里反过来钉：数据目录行**只有**「打开」，缓存目录行仍保留那对键。
   */
  it("spc02_the_data_row_has_no_second_move_entry_and_the_cache_row_keeps_it", () => {
    mountPaths({
      storageSnapshot: {
        ...snapshot,
        paths: { ...snapshot.paths, isCustomDataRoot: true, isCustomWebviewRoot: true },
      },
    });
    expect(rowKey("数据目录", "更改目录"), "数据目录行又长出第二套搬根入口").toBeNull();
    expect(rowKey("数据目录", "恢复默认目录"), "数据目录行又长出第二套搬根入口").toBeNull();
    expect(rowKey("数据目录", "打开目录"), "数据目录行的「打开」没了").not.toBeNull();
    /* 缓存目录：自定义根 → 给「恢复默认目录」而不是「更改目录」 */
    expect(rowKey("缓存目录", "更改目录"), "自定义缓存根不该再给「更改目录」").toBeNull();
    const restore = rowKey("缓存目录", "恢复默认目录");
    expect(restore, "自定义缓存根缺少「恢复默认目录」").not.toBeNull();
    act(() => { restore?.click(); });
    expect(mounted.onRestoreDefaultCacheDirectory, "「恢复默认目录」没接到缓存目录那一路").toHaveBeenCalledTimes(1);
  });

  it("spc03_choosing_a_directory_hits_the_right_callback", () => {
    mountPaths();
    expect(rowKey("数据目录", "更改目录"), "数据目录行不该有「更改目录」").toBeNull();
    act(() => { rowKey("缓存目录", "更改目录")?.click(); });
    expect(mounted.onChooseCacheDirectory, "缓存目录那行的「更改目录」接错了").toHaveBeenCalledTimes(1);
    /* 卡头那颗刷新快照键（`headerAside`）：aria-label 是「检查存储」 */
    const refreshKey = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => (button.getAttribute("aria-label") ?? "").includes("检查存储"));
    expect(refreshKey, "卡头没有刷新快照键").not.toBeUndefined();
    act(() => { refreshKey?.click(); });
    expect(mounted.onRefreshStorageSnapshot, "卡头那颗刷新键没接到刷新快照").toHaveBeenCalledTimes(1);
  });
});

describe("本机目录组的样式挂点（[复核修复]）", () => {
  it("spc05_the_group_carries_the_local_paths_panel_class_on_the_preference_group", () => {
    /* `settings.css` 里的
         `.settings-local-paths-panel .qp-icon-action-neutral:hover:not(:disabled)`
         `.settings-local-paths-panel .qp-icon-action-neutral:active:not(:disabled)`
       两条规则靠这个 class 给三个目录行的图标键配 hover / 按下的背景与前景。
       本文件拆出来时这一处丢了 → 两条规则成了永不命中的孤岛，症状不是报错，是
       "图标键 hover 没反应"。判据按**渲染结果**断言（grep 源码证明不了 class 落在哪个元素上，
       挂到别的 div 上一样能 grep 到）。 */
    mountPaths();
    const panel = container.querySelector<HTMLElement>(".settings-local-paths-panel");
    expect(panel, "目录组没挂 settings-local-paths-panel → 图标键的 hover 配色整段丢失").not.toBeNull();
    expect(
      panel?.classList.contains("settings-preference-group"),
      "这个 class 必须挂在 SettingsPreferenceGroup 上（CSS 的两条规则是它的后代选择器）",
    ).toBe(true);
    /* 规则要真能命中：目录行右侧的控制键必须就是 `.qp-icon-action-neutral` */
    const action = panel?.querySelector(".settings-preference-control .qp-icon-action-neutral");
    expect(action, "目录行里的图标键不是 .qp-icon-action-neutral，两条 CSS 规则仍然命中不了").not.toBeNull();
  });
});

describe("清理档位滑杆：下标 → cleanupOptions 的值", () => {
  it("spc04_moving_the_slider_reports_the_option_value_not_the_index", async () => {
    const rangeChange = vi.fn<(value: CleanupRange) => void>();
    act(() => {
      root.render(createElement(LocaleProvider, {
        locale: "zh-CN",
        children: createElement(SettingsDataSafetyPanel, {
          cleanupRange: 7,
          /* 故意乱序：滑杆必须先排序，档位才是 [7, 30] */
          cleanupOptions: [{ value: 30, label: "30 天" }, { value: 7, label: "7 天" }],
          isCleaning: false,
          onCleanupRangeChange: rangeChange,
          onCleanup: () => undefined,
          onOpenDataExport: () => undefined,
          onOpenDataImport: () => undefined,
          isImportBusy: false,
          storageSnapshot: snapshot,
          isStorageBusy: false,
          onRefreshStorageSnapshot: () => undefined,
          onScheduleWebviewCacheClear: () => undefined,
              onChooseCacheDirectory: () => undefined,
              onRestoreDefaultCacheDirectory: () => undefined,
          onOpenStorageDirectory: () => undefined,
        }),
      }));
    });
    /* 打开「清理历史记录」的确认框：档位滑杆在框里 */
    const historyKey = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"))
      .find((row) => (row.querySelector(".settings-preference-title")?.textContent ?? "").includes("清理历史"))
      ?.querySelector<HTMLButtonElement>(".settings-preference-control button");
    act(() => { historyKey?.click(); });
    await act(async () => { await Promise.resolve(); });

    const slider = document.body.querySelector<HTMLElement>(".settings-history-cleanup-slider");
    expect(slider, "确认框里没有档位滑杆").not.toBeNull();
    const stepperKeys = Array.from(slider?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(stepperKeys.length, "档位滑杆没有加减两颗键").toBeGreaterThanOrEqual(2);
    act(() => { stepperKeys[stepperKeys.length - 1]?.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(rangeChange, "档位滑杆没有上报 `onCleanupRangeChange`").toHaveBeenCalled();
    expect(rangeChange.mock.calls[0][0], "上报的是下标而不是档位值（30/7 乱序时必须排序后取 value）")
      .toBe(30);
  });
});
