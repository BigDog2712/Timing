(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsStoragePathsGroup from "./SettingsStoragePathsGroup";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";

/**
 * [QA 补测] 「数据与同步」整组的**渲染级**判据（补齐 `settingsDataGroupUniform` 只渲染了导出 /
 * 清理两组的空白）。
 *
 * 三条口径：
 *   ① 每个子组的每一行都**真的有标题 + 右侧控件**（不是把旧结构套个新类名：旧结构是
 *      `flex items-center justify-between` 的裸行，没有 `.settings-preference-title`）；
 *   ② `busy` 的禁用态逐个动作核（目录切换 / 恢复默认目录 / 刷新快照）——
 *      拆文件最容易掉的就是这一档；
 *   ③ 快照未到位时是**同构占位行**（键真的禁用、位置不跳），不是空白或半个网格。
 */

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

function mount(element: ReactElement): void {
  act(() => root.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
}


function storageSnapshot(overrides: { customDataRoot?: boolean; customWebviewRoot?: boolean } = {}): StorageSnapshot {
  return {
    paths: {
      installDir: "C:\\Apps\\Timing",
    timingDataRoot: "C:\\Users\\me\\AppData\\com.timing.app",
      dataRoot: overrides.customDataRoot ? "D:\\TimingData" : "C:\\Users\\me\\AppData\\Timing",
      databasePath: "C:\\Users\\me\\AppData\\Timing\\timing.db",
      backupDir: "C:\\Users\\me\\AppData\\Timing\\backups",
      remoteBackupTempDir: "C:\\Users\\me\\AppData\\Timing\\tmp",
      webviewRoot: overrides.customWebviewRoot ? "D:\\Cache" : "C:\\Users\\me\\AppData\\Timing\\webview",
      isCustomDataRoot: Boolean(overrides.customDataRoot),
      isCustomWebviewRoot: Boolean(overrides.customWebviewRoot),
    },
    sizes: { installDirSizeBytes: 3145728, dataSizeBytes: 2097152, timingDataSizeBytes: 4194304, backupDirSizeBytes: 0 },
    webviewCache: {
      webviewRoot: "C:\\Users\\me\\AppData\\Timing\\webview",
      ebwebviewPath: "C:\\Users\\me\\AppData\\Timing\\webview\\EBWebView",
      totalSizeBytes: 1048576,
      reclaimableSizeBytes: 0,
      lastTrimAtMs: null,
      entries: [],
    },
    maintenance: { lastError: null },
  };
}

/** 每一行都必须有「非空标题 + 右侧控件区」，且真的在偏好行里 */
function expectEveryRowIsReal(): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"));
  expect(rows.length, "一行偏好行都没有渲染出来").toBeGreaterThan(0);
  for (const row of rows) {
    const title = row.querySelector<HTMLElement>(".settings-preference-title");
    expect(title, "这一行没有标题区（旧结构才会没有）").not.toBeNull();
    expect((title?.textContent ?? "").trim(), "这一行的标题是空的").not.toBe("");
    expect(row.querySelector(".settings-preference-control"), "这一行没有右侧控件区").not.toBeNull();
  }
}

function controlButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-preference-control button"));
}

describe("数据组渲染级：行是真的（标题 + 右侧控件）", () => {
  it("qd02_storage_group_renders_three_directory_rows_with_readouts", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: storageSnapshot(),
      isStorageBusy: false,
      busy: false,
      onRefreshStorageSnapshot: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultCacheDirectory: () => undefined,
      onOpenStorageDirectory: () => undefined,
    }));
    expectEveryRowIsReal();
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"));
    expect(rows, "安装 / 缓存 / 数据三个目录各一行").toHaveLength(3);
    /* 体积读数在标题区（`settings-preference-meta`），三行都要有 */
    for (const row of rows) {
      expect(row.querySelector(".settings-preference-meta"), "目录行缺体积读数").not.toBeNull();
    }
    expect(container.textContent, "读数按 MB 展示").toContain("3 MB");
  });
});

describe("busy 的禁用态逐个动作核", () => {
  /**
   * [设置页七项改造·批 6] busy 门控 + 数据目录行只剩「打开」。
   *
   * 原来这条用例靠「数据根是自定义的 → 那一行给‘恢复默认目录’」来同时证明两件事。
   * 批 6 把数据目录行的更改/恢复两个键下线了（搬根入口唯一在同步 · SQLite 落点设置，
   * 见 `SettingsStoragePathCallbacks.spc02`），所以改用**缓存行**证明 busy 门控——
   * 缓存行仍然保留 `更改 / 恢复默认` 这一对。
   */
  it("qd04_busy_disables_the_move_keys_and_the_data_row_only_opens", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: storageSnapshot({ customWebviewRoot: true }),
      isStorageBusy: false,
      busy: true,
      onRefreshStorageSnapshot: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultCacheDirectory: () => undefined,
      onOpenStorageDirectory: () => undefined,
    }));
    /* 缓存根是自定义的 → 那一行给的是「恢复默认目录」而不是「更改目录」 */
    const labels = controlButtons().map((button) => button.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => label.includes("恢复默认")), "自定义缓存根缺少「恢复默认目录」").toBe(true);
    /* 「打开目录」本来就**不受** busy 管（HEAD 里它也没有 `disabled`）：只读动作，放行是既有口径。
       其余（更改目录 / 恢复默认目录）必须被 busy 挡住。 */
    for (const button of controlButtons()) {
      const label = button.getAttribute("aria-label") ?? "";
      if (label.includes("打开目录")) {
        expect(button.disabled, "「打开目录」是只读动作，不该被 busy 挡住").toBe(false);
        continue;
      }
      expect(button.disabled, `busy 时目录键仍可点：${label}`).toBe(true);
    }
    /* 数据目录行只有一颗「打开」：多出来的任何键都是第二套搬根入口 */
    const dataRow = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"))
      .find((row) => (row.querySelector(".settings-preference-title")?.textContent ?? "").includes("数据目录"));
    const dataKeys = Array.from(
      dataRow?.querySelectorAll<HTMLButtonElement>(".settings-preference-control button") ?? [],
    );
    expect(dataKeys, "数据目录行应当只有一颗「打开目录」").toHaveLength(1);
    expect(dataKeys[0].getAttribute("aria-label") ?? "").toContain("打开目录");
  });

  it("qd05_snapshot_placeholder_rows_are_disabled_and_keep_the_layout", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: null,
      isStorageBusy: true,
      busy: false,
      onRefreshStorageSnapshot: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultCacheDirectory: () => undefined,
      onOpenStorageDirectory: () => undefined,
    }));
    /* 快照未到位：仍是 3 行同构占位（位置不跳），键**真的**禁用 */
    expect(container.querySelectorAll(".settings-preference-row"), "占位行数不对").toHaveLength(3);
    const placeholders = container.querySelectorAll(".settings-preference-meta-placeholder");
    expect(placeholders.length, "占位行的读数位缺失（会跳行）").toBe(3);
    for (const button of controlButtons()) {
      expect(button.disabled, "占位行的键必须是禁用的（点了会静默失败）").toBe(true);
    }
  });
});
