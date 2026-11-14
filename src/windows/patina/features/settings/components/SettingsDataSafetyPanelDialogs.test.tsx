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
 * [QA 补测] 「存储」卡的**外壳 + 五个对话框**（`SettingsDataSafetyPanel` 170 行 +
 * `useSettingsDataSafetyDialogs` 201 行 + `SettingsDataSafetyDialogs` 291 行）。
 *
 * 为什么必须补：本轮把 695 行的面板拆成六个文件，其中**五个对话框的状态机与 JSX 整体搬走**，
 * 而原来就没有任何用例挂过这个面板 —— 搬迁时"丢掉一个对话框 / 把某颗键接到别的 open* 上"
 * 不会有任何测试变红（`settingsDataGroupUniform` 只做源码级类名与行数断言）。
 * 这里从**行**点进去，断言"点了那颗键，出现的是哪个框、确认之后调的是哪个回调"：
 *   ① 清理历史记录（含档位滑杆）→ `onCleanup`；
 *   ② 清理缓存 → `onScheduleWebviewCacheClear`；
 *   ③ 恢复：没有远端目标时直接走"选策略"，且先等 `onPrepareRestoreBackup` 返回真。
 */
const REMOTE_DIR = "Timing/";

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
    remoteDir: REMOTE_DIR,
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

/* `vi.fn()` 不带签名时是 `Mock<Procedure | Constructable>`，赋给具体回调类型会报 TS2769 ——
   所以每个桩都写上它替代的那个签名。 */
type VoidMock = ReturnType<typeof vi.fn<() => void>>;

type Callbacks = {
  onCleanup: VoidMock;
  onExportBackup: VoidMock;
  onPrepareRestoreBackup: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  onRestoreBackup: ReturnType<typeof vi.fn<(strategy: "merge" | "replace") => void>>;
  onClearPendingRestoreBackup: VoidMock;
  onScheduleWebviewCacheClear: VoidMock;
  onOpenDataExport: VoidMock;
  onOpenDataImport: VoidMock;
};

let cb: Callbacks;

function mountShell(): void {
  cb = {
    onCleanup: vi.fn<() => void>(),
    onExportBackup: vi.fn<() => void>(),
    onPrepareRestoreBackup: vi.fn<() => Promise<boolean>>(async () => true),
    onRestoreBackup: vi.fn<(strategy: "merge" | "replace") => void>(),
    onClearPendingRestoreBackup: vi.fn<() => void>(),
    onScheduleWebviewCacheClear: vi.fn<() => void>(),
    onOpenDataExport: vi.fn<() => void>(),
    onOpenDataImport: vi.fn<() => void>(),
  };
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
        onCleanupRangeChange: () => undefined,
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
      }),
    }));
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** 某一个子组（按组标题文字定位）里的按钮 */
function buttonsInGroup(groupTitlePart: string): HTMLButtonElement[] {
  const group = Array.from(document.querySelectorAll<HTMLElement>(".settings-preference-group"))
    .find((node) => (node.querySelector(".settings-preference-group-title")?.textContent ?? "")
      .includes(groupTitlePart));
  const list = group?.querySelector(".settings-preference-list") ?? group;
  return Array.from(list?.querySelectorAll<HTMLButtonElement>(".settings-preference-control button") ?? []);
}

const lastDialog = (): HTMLElement | undefined => {
  const dialogs = Array.from(document.body.querySelectorAll<HTMLElement>(".qp-dialog-surface"));
  return dialogs[dialogs.length - 1];
};

/** 对话框 actions 里的最后一颗（确认键） */
const confirmOf = (surface: HTMLElement | undefined) => Array.from(
  surface?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? [],
).pop() ?? null;

describe("外壳 + 五个对话框：从行点进去，看的是哪个框、调的是哪个回调", () => {
  it("qd06_the_shell_renders_the_four_groups_and_the_card_header", () => {
    mountShell();
    expect(document.querySelectorAll(".settings-preference-group"), "四个子组没全渲染")
      .toHaveLength(4);
    const header = document.querySelector(".qp-panel .settings-panel-header, .qp-panel h3");
    expect(header, "卡片没有标题（与同页其它卡不同构）").not.toBeNull();
    expect((header?.textContent ?? "").trim(), "卡片标题是空的").not.toBe("");
    /* 未点任何键时一个对话框都不许冒出来 */
    expect(document.querySelectorAll(".qp-dialog-surface"), "一进页面就有对话框").toHaveLength(0);
  });

  it("qd07_history_cleanup_row_opens_its_dialog_with_the_range_slider", async () => {
    mountShell();
    /* 组的第 2 行才是「清理历史记录」（第 1 行是清理缓存）—— 两颗键的文案都含「清理」，
       按文字找会串，所以按行序取，并用 qd08 反向钉住第 1 行是缓存。 */
    const historyKey = buttonsInGroup("数据管理")[1];
    expect(historyKey, "「数据管理」组里没有清理历史记录键").toBeDefined();
    act(() => { historyKey?.click(); });
    await flush();

    const surface = document.querySelector<HTMLElement>(".settings-history-cleanup-dialog");
    expect(surface, "清理历史记录的对话框没打开（拆分时搬丢了？）").not.toBeNull();
    expect(surface?.querySelector(".settings-history-cleanup-slider"), "档位滑杆丢了").not.toBeNull();
    /* 没确认之前不许真清理 */
    expect(cb.onCleanup).not.toHaveBeenCalled();

    act(() => { confirmOf(surface ?? undefined)?.click(); });
    await flush();
    expect(cb.onCleanup, "确认之后没有触发清理").toHaveBeenCalledTimes(1);
  });

  it("qd08_cache_clear_row_opens_the_restart_dialog_and_schedules_the_clear", async () => {
    mountShell();
    const cacheKey = buttonsInGroup("数据管理")
      .find((button) => (button.textContent ?? "").includes("缓存"));
    expect(cacheKey, "「数据管理」组里没有清理缓存键").toBeDefined();
    act(() => { cacheKey?.click(); });
    await flush();

    const surface = lastDialog();
    expect(surface, "清理缓存的确认框没打开").toBeDefined();
    expect(cb.onScheduleWebviewCacheClear).not.toHaveBeenCalled();
    act(() => { confirmOf(surface)?.click(); });
    await flush();
    expect(cb.onScheduleWebviewCacheClear, "确认缓存清理后没有安排清理动作").toHaveBeenCalledTimes(1);
  });

  it("qd09_restore_waits_for_the_prepare_step_and_then_asks_for_a_strategy", async () => {
    mountShell();
    const restoreKey = buttonsInGroup("备份与恢复")[1];
    expect(restoreKey, "备份与恢复组里没有恢复键").toBeDefined();
    act(() => { restoreKey?.click(); });
    await flush();

    /* 没有远端目标 → 不弹「选来源」，直接走本地准备 */
    expect(cb.onPrepareRestoreBackup, "恢复没有先走准备动作").toHaveBeenCalledTimes(1);
    expect(document.querySelector(".settings-data-action-dialog"), "没有远端目标却弹了「选来源」")
      .toBeNull();
    /* 准备成功之后才问策略（合并 / 替换） */
    const strategy = document.querySelector<HTMLElement>(".qp-segmented-filter");
    expect(strategy, "准备完成之后没有弹恢复策略选择").not.toBeNull();
    expect(strategy?.querySelectorAll(".qp-segmented-filter-item").length, "策略选项不是两项").toBe(2);

    act(() => { confirmOf(lastDialog())?.click(); });
    await flush();
    expect(cb.onRestoreBackup, "确认策略之后没有真的恢复").toHaveBeenCalledTimes(1);
  });
});
