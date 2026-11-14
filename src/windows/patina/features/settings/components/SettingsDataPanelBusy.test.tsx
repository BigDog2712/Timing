(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import type { RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";

/**
 * [QA 补测] 「存储」卡的 **`busy` 汇总口径 + 六颗动作键的接线**（面板级）。
 *
 * `SettingsDataGroupStates.test.tsx` 逐个子组核禁用态，但 `busy` 是**面板**算出来的
 * （七项 or 起来），任何一个来源漏进 `busy`，子组里那颗键就会在"另一条长任务正在写库"
 * 的时候还能点 —— 这正是拆分时最容易掉的一档，而原来没有任何用例从面板这一层验过。
 *
 * 七项来源（`SettingsDataSafetyPanel` 里的 `busy` 表达式）：
 *   isExportingBackup / isRestoringBackup / isStorageBusy /
 *   remoteBackup.isUploading / isListing / isDownloading / isImportBusy
 *
 * 判据一律用**用户能看见的东西**：`.settings-preference-control button` 的 `disabled`
 * 与文案，不去读 props。行标题取自 zh-CN 真实文案（`dataExportTitle` 等），不手抄近似值。
 */

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
  } as RemoteBackupState;
}

const snapshot: StorageSnapshot = {
  paths: {
    installDir: "C:\\Apps\\Timing",
    dataRoot: "C:\\Users\\me\\AppData\\Timing",
    databasePath: "C:\\Users\\me\\AppData\\Timing\\timing.db",
    backupDir: "C:\\Users\\me\\AppData\\Timing\\backups",
    remoteBackupTempDir: "C:\\Users\\me\\AppData\\Timing\\tmp",
    webviewRoot: "C:\\Users\\me\\AppData\\Timing\\webview",
    isCustomDataRoot: false,
    isCustomWebviewRoot: false,
  },
  sizes: { installDirSizeBytes: 1048576, dataSizeBytes: 524288, backupDirSizeBytes: 0 },
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

/** zh-CN 里这六行的行标题（= 用户屏幕上看到的字，不是类名） */
const ACTION_ROW_TITLES = [
  "数据导出",
  "导入",
  "备份活动库",
  "恢复活动库",
  "清理缓存",
  "清理历史记录",
] as const;

type Overrides = Partial<Parameters<typeof SettingsDataSafetyPanel>[0]>;

let container: HTMLDivElement;
let root: Root;
const cb = {
  onCleanup: vi.fn<() => void>(),
  onExportBackup: vi.fn<() => void>(),
  onPrepareRestoreBackup: vi.fn<() => Promise<boolean>>(async () => true),
  onRestoreBackup: vi.fn<(strategy: "merge" | "replace") => void>(),
  onClearPendingRestoreBackup: vi.fn<() => void>(),
  onOpenDataExport: vi.fn<() => void>(),
  onOpenDataImport: vi.fn<() => void>(),
  onScheduleWebviewCacheClear: vi.fn<() => void>(),
};
let rangeChange = vi.fn<(value: number) => void>();

beforeEach(async () => {
  for (const spy of Object.values(cb)) spy.mockClear();
  rangeChange = vi.fn<(value: number) => void>();
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

function mount(overrides: Overrides = {}): void {
  act(() => {
    root.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(SettingsDataSafetyPanel, {
        cleanupRange: 7,
        cleanupOptions: [{ value: 7, label: "7 天" }, { value: 30, label: "30 天" }],
        restoreStrategy: "merge",
        isCleaning: false,
        isExportingBackup: false,
        isRestoringBackup: false,
        onCleanupRangeChange: rangeChange as never,
        onRestoreStrategyChange: () => undefined,
        onCleanup: cb.onCleanup,
        onExportBackup: cb.onExportBackup,
        onPrepareRestoreBackup: cb.onPrepareRestoreBackup,
        onRestoreBackup: cb.onRestoreBackup,
        onClearPendingRestoreBackup: cb.onClearPendingRestoreBackup,
        onOpenDataExport: cb.onOpenDataExport,
        onOpenDataImport: cb.onOpenDataImport,
        isImportBusy: false,
        remoteBackup: remoteBackup(),
        storageSnapshot: snapshot,
        isStorageBusy: false,
        onRefreshStorageSnapshot: () => undefined,
        onScheduleWebviewCacheClear: cb.onScheduleWebviewCacheClear,
        onChooseDataDirectory: () => undefined,
        onChooseCacheDirectory: () => undefined,
        onRestoreDefaultDataDirectory: () => undefined,
        onRestoreDefaultCacheDirectory: () => undefined,
        onOpenStorageDirectory: () => undefined,
        ...overrides,
      }),
    }));
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

/** `SettingsBackupDialog` 是 `lazy()` 的：要等一次真实的模块加载（macrotask）才挂上 */
async function waitForLazyDialog(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    if (document.body.querySelector(".qp-dialog-surface")) return;
  }
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".settings-preference-row"));
}

function rowTitle(row: HTMLElement): string {
  return (row.querySelector(".settings-preference-title")?.textContent ?? "").trim();
}

function actionRow(title: string): HTMLElement | undefined {
  return rows().find((row) => rowTitle(row).includes(title));
}

function actionKey(title: string): HTMLButtonElement | null {
  return actionRow(title)?.querySelector<HTMLButtonElement>(".settings-preference-control button") ?? null;
}

/** 七项 `busy` 来源，逐个打开 */
const BUSY_SOURCES: [string, Overrides][] = [
  ["isExportingBackup", { isExportingBackup: true }],
  ["isRestoringBackup", { isRestoringBackup: true }],
  ["isStorageBusy", { isStorageBusy: true }],
  ["remoteBackup.isUploading", { remoteBackup: remoteBackup({ isUploading: true }) }],
  ["remoteBackup.isListing", { remoteBackup: remoteBackup({ isListing: true }) }],
  ["remoteBackup.isDownloading", { remoteBackup: remoteBackup({ isDownloading: true }) }],
  ["isImportBusy", { isImportBusy: true }],
];

describe("「存储」卡的 busy 汇总口径（七项，逐个验）", () => {
  it("qd10_idle_renders_four_groups_and_six_clickable_action_keys", () => {
    mount();
    expect(document.querySelectorAll(".settings-preference-group"), "四个子组没全渲染").toHaveLength(4);
    for (const title of ACTION_ROW_TITLES) {
      const key = actionKey(title);
      expect(key, `空闲态找不到「${title}」那一行的按钮（标题 + 右侧控件）`).not.toBeNull();
      expect(key?.disabled, `空闲态「${title}」是禁用的（永久禁用）`).toBe(false);
    }
  });

  it.each(BUSY_SOURCES)("qd11_busy_from_%s_disables_every_action_key", (name, patch) => {
    /* 任何一条长任务在跑 → 六颗动作键全部禁用。漏一项就是"导出的同时点了恢复"。 */
    mount(patch);
    for (const title of ACTION_ROW_TITLES) {
      const key = actionKey(title);
      expect(key, `[${name}] 找不到「${title}」的按钮`).not.toBeNull();
      expect(key?.disabled, `[${name}] 时「${title}」仍可点（busy 汇总漏了这一项）`).toBe(true);
    }
  });
});

describe("六颗动作键的接线（点了调的是哪个回调）", () => {
  it("qd12_export_and_import_keys_call_their_own_callbacks", async () => {
    mount();
    act(() => { actionKey("数据导出")?.click(); });
    await flush();
    expect(cb.onOpenDataExport, "「数据导出」没接到 onOpenDataExport").toHaveBeenCalledTimes(1);
    expect(cb.onOpenDataImport, "点导出却调了导入").not.toHaveBeenCalled();
    expect(cb.onExportBackup, "点导出跳到了活动库备份").not.toHaveBeenCalled();

    act(() => { actionKey("导入")?.click(); });
    await flush();
    expect(cb.onOpenDataImport, "「导入」没接到 onOpenDataImport").toHaveBeenCalledTimes(1);
    expect(cb.onOpenDataExport).toHaveBeenCalledTimes(1);
  });

  it("qd13_backup_key_opens_the_target_dialog_and_only_then_exports", async () => {
    /* 「备份活动库」先问存哪儿（本地 / WebDAV），选完本地才调 `onExportBackup` */
    mount();
    act(() => { actionKey("备份活动库")?.click(); });
    await waitForLazyDialog();
    await flush();
    expect(cb.onExportBackup, "还没选备份位置就导出了").not.toHaveBeenCalled();
    const surface = Array.from(document.body.querySelectorAll<HTMLElement>(".qp-dialog-surface")).pop();
    expect(surface, "点「备份活动库」没有弹出选位置的对话框").toBeDefined();
    /* 「本机 ZIP 文件」那一项是 `settings-dialog-action-composite` 的整块命中区（按钮本身没有文字） */
    const localKey = surface?.querySelector<HTMLButtonElement>(
      ".settings-backup-local-trigger .settings-dialog-action-hit-target",
    );
    expect(localKey ?? null, "选位置的对话框里没有「本机 ZIP 文件」那一项").not.toBeNull();
    act(() => { localKey?.click(); });
    await flush();
    expect(cb.onExportBackup, "选了本机备份却没触发导出").toHaveBeenCalledTimes(1);
  });

  it("qd14_history_cleanup_key_switches_to_running_copy_and_locks_while_cleaning", () => {
    mount({ isCleaning: true });
    const key = actionKey("清理历史记录");
    expect(key, "没找到「清理历史记录」那颗键").not.toBeNull();
    expect(key?.disabled, "清理进行中仍可再次发起清理").toBe(true);
    expect(key?.textContent ?? "", "清理进行中文案没切成「正在清理...」").toContain("正在清理");
  });

  it("qd15_cache_clear_key_opens_the_restart_dialog_and_never_fires_directly", async () => {
    mount();
    act(() => { actionKey("清理缓存")?.click(); });
    await flush();
    expect(cb.onScheduleWebviewCacheClear, "还没确认就安排了缓存清理（会直接重启应用）")
      .not.toHaveBeenCalled();
    const surface = Array.from(document.body.querySelectorAll<HTMLElement>(".qp-dialog-surface")).pop();
    expect(surface, "「清理缓存」没有确认框").toBeDefined();
    expect(surface?.textContent ?? "", "确认框里没有「重启并应用」").toContain("重启并应用");
  });
});
