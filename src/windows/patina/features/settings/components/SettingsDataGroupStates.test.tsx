(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsDataBackupGroup from "./SettingsDataBackupGroup";
import SettingsStoragePathsGroup from "./SettingsStoragePathsGroup";
import type { RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";

/**
 * [QA 补测] 「数据与同步」整组的**渲染级**判据（补齐 `settingsDataGroupUniform` 只渲染了导出 /
 * 清理两组的空白）。
 *
 * 三条口径：
 *   ① 每个子组的每一行都**真的有标题 + 右侧控件**（不是把旧结构套个新类名：旧结构是
 *      `flex items-center justify-between` 的裸行，没有 `.settings-preference-title`）；
 *   ② `busy` 的禁用态逐个动作核（导出 / 导入 / 备份 / 恢复 / 目录切换 / 恢复默认目录 /
 *      刷新快照）—— 拆文件最容易掉的就是这一档；
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

function remoteBackup(overrides: Partial<RemoteBackupState> = {}): RemoteBackupState {
  return {
    config: null,
    hasSecret: false,
    loading: false,
    configDialogOpen: false,
    restoreDialogOpen: false,
    entries: [],
    isTesting: false,
    isSaving: false,
    isUploading: false,
    isListing: false,
    isDownloading: false,
    connectionStatus: "unknown",
    openConfigDialog: () => undefined,
    closeConfigDialog: () => undefined,
    revealSavedPassword: async () => null,
    saveConfig: async () => true,
    deleteConfig: async () => undefined,
    testConfig: async () => true,
    uploadBackup: async () => null,
    openRestoreDialog: async () => undefined,
    closeRestoreDialog: () => undefined,
    restoreEntry: async () => undefined,
    ...overrides,
  };
}

function storageSnapshot(overrides: { customDataRoot?: boolean; customWebviewRoot?: boolean } = {}): StorageSnapshot {
  return {
    paths: {
      installDir: "C:\\Apps\\Timing",
      dataRoot: overrides.customDataRoot ? "D:\\TimingData" : "C:\\Users\\me\\AppData\\Timing",
      databasePath: "C:\\Users\\me\\AppData\\Timing\\timing.db",
      backupDir: "C:\\Users\\me\\AppData\\Timing\\backups",
      remoteBackupTempDir: "C:\\Users\\me\\AppData\\Timing\\tmp",
      webviewRoot: overrides.customWebviewRoot ? "D:\\Cache" : "C:\\Users\\me\\AppData\\Timing\\webview",
      isCustomDataRoot: Boolean(overrides.customDataRoot),
      isCustomWebviewRoot: Boolean(overrides.customWebviewRoot),
    },
    sizes: { installDirSizeBytes: 3145728, dataSizeBytes: 2097152, backupDirSizeBytes: 0 },
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
  it("qd01_backup_group_renders_three_real_rows_and_the_remote_row", () => {
    mount(createElement(SettingsDataBackupGroup, {
      busy: false,
      isExportingBackup: false,
      isRestoringBackup: false,
      remoteBackup: remoteBackup(),
      backupButtonRef: createRef<HTMLButtonElement>(),
      restoreButtonRef: createRef<HTMLButtonElement>(),
      onBackupAction: () => undefined,
      onRestoreAction: () => undefined,
      onRestoreEntrySelected: () => undefined,
    }));
    expectEveryRowIsReal();
    /* 备份 / 恢复 / WebDAV 三行同处一个分隔线列表（远端那一行由子组件插进父组的 list） */
    const rows = container.querySelectorAll(".settings-preference-list > .settings-preference-row");
    expect(rows.length, "备份与恢复组应当有 3 行（本地备份 / 本地恢复 / WebDAV）").toBe(3);
  });

  it("qd02_storage_group_renders_three_directory_rows_with_readouts", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: storageSnapshot(),
      isStorageBusy: false,
      busy: false,
      onRefreshStorageSnapshot: () => undefined,
      onChooseDataDirectory: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultDataDirectory: () => undefined,
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
  it("qd03_backup_and_restore_buttons_are_disabled_while_busy", () => {
    mount(createElement(SettingsDataBackupGroup, {
      busy: true,
      isExportingBackup: false,
      isRestoringBackup: false,
      remoteBackup: remoteBackup(),
      backupButtonRef: createRef<HTMLButtonElement>(),
      restoreButtonRef: createRef<HTMLButtonElement>(),
      onBackupAction: () => undefined,
      onRestoreAction: () => undefined,
      onRestoreEntrySelected: () => undefined,
    }));
    /* 只核**本地**那两颗（导出备份 / 恢复备份）：WebDAV 那一行的键用的是它自己那份 busy
       （`isSaving` / `isTesting` / 上传下载），页级 busy 从来没传进去 —— HEAD 也是如此，
       属于既有口径，不在本轮的"禁用态是否保留"范围内（另有一条 qd03b 单独钉它）。 */
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"));
    const exportButton = rows[0]?.querySelector<HTMLButtonElement>("button");
    const restoreButton = rows[1]?.querySelector<HTMLButtonElement>("button");
    expect(exportButton, "没找到导出备份键").not.toBeNull();
    expect(restoreButton, "没找到恢复备份键").not.toBeNull();
    expect(exportButton?.disabled, "busy 时导出备份仍可点").toBe(true);
    expect(restoreButton?.disabled, "busy 时恢复备份仍可点").toBe(true);
  });

  it("qd03b_remote_row_keys_follow_their_own_busy_flags", () => {
    /* WebDAV 行的三颗键：`isSaving` / `isUploading` / `isListing` / `isDownloading` 任一在跑就禁用。
       这是 HEAD 就有的口径，拆文件后不许丢 —— 丢了就是"上传中点删除"这类并发写。 */
    mount(createElement(SettingsDataBackupGroup, {
      busy: false,
      isExportingBackup: false,
      isRestoringBackup: false,
      remoteBackup: remoteBackup({
        config: {
          url: "https://dav.example.com/dav/",
          username: "me",
          remoteDir: "Timing/",
        } as RemoteBackupState["config"],
        hasSecret: true,
        isUploading: true,
      }),
      backupButtonRef: createRef<HTMLButtonElement>(),
      restoreButtonRef: createRef<HTMLButtonElement>(),
      onBackupAction: () => undefined,
      onRestoreAction: () => undefined,
      onRestoreEntrySelected: () => undefined,
    }));
    const remoteRow = Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"))
      .find((row) => (row.textContent ?? "").includes("WebDAV"));
    expect(remoteRow, "没找到 WebDAV 那一行").toBeDefined();
    const keys = Array.from(remoteRow?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(keys.length, "WebDAV 行应有测试连接 / 编辑 / 删除三颗键").toBe(3);
    for (const key of keys) {
      expect(key.disabled, `上传中这颗键仍可点：${key.textContent}`).toBe(true);
    }
  });

  it("qd04_path_keys_are_disabled_while_busy_and_switch_by_custom_root", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: storageSnapshot({ customDataRoot: true }),
      isStorageBusy: false,
      busy: true,
      onRefreshStorageSnapshot: () => undefined,
      onChooseDataDirectory: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultDataDirectory: () => undefined,
      onRestoreDefaultCacheDirectory: () => undefined,
      onOpenStorageDirectory: () => undefined,
    }));
    /* 数据根是自定义的 → 那一行给的是「恢复默认目录」而不是「更改目录」 */
    const labels = controlButtons().map((button) => button.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => label.includes("恢复默认")), "自定义数据根缺少「恢复默认目录」").toBe(true);
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
  });

  it("qd05_snapshot_placeholder_rows_are_disabled_and_keep_the_layout", () => {
    mount(createElement(SettingsStoragePathsGroup, {
      storageSnapshot: null,
      isStorageBusy: true,
      busy: false,
      onRefreshStorageSnapshot: () => undefined,
      onChooseDataDirectory: () => undefined,
      onChooseCacheDirectory: () => undefined,
      onRestoreDefaultDataDirectory: () => undefined,
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
