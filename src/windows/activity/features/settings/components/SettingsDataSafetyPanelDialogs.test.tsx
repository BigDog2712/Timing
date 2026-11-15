(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";

/**
 * 「数据安全」卡的**外壳 + 两个对话框**（`SettingsDataSafetyPanel` +
 * `useSettingsDataSafetyDialogs` + `SettingsDataSafetyDialogs`）。
 *
 * 判据从**行**点进去，看"点了那颗键，出现的是哪个框、确认之后调的是哪个回调"：
 *   ① 清理历史记录（含档位滑杆）→ `onCleanup`；
 *   ② 清理缓存（重启并应用）→ `onScheduleWebviewCacheClear`。
 *
 * [设置页七项改造·批 5] 「活动库备份与恢复」整块下线：原来还有
 * ③ 选备份位置 ④ 选恢复来源 ⑤ 恢复策略 三个框，连同它们的行一起删了。
 * 最后一条用例（qd09）改成**反向回归**：那两个入口与那三个框都不许再出现 ——
 * 功能删掉之后，把它接回来只需要一次 import，没人会记得为什么删。
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

type VoidMock = ReturnType<typeof vi.fn<() => void>>;

type Callbacks = {
  onCleanup: VoidMock;
  onScheduleWebviewCacheClear: VoidMock;
  onOpenDataExport: VoidMock;
  onOpenDataImport: VoidMock;
};

let cb: Callbacks;

function mountShell(): void {
  cb = {
    onCleanup: vi.fn<() => void>(),
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
        isCleaning: false,
        onCleanupRangeChange: () => undefined,
        onCleanup: cb.onCleanup,
        onOpenDataExport: cb.onOpenDataExport,
        onOpenDataImport: cb.onOpenDataImport,
        isImportBusy: false,
        storageSnapshot: snapshot,
        isStorageBusy: false,
        onRefreshStorageSnapshot: () => undefined,
        onScheduleWebviewCacheClear: cb.onScheduleWebviewCacheClear,
          onChooseCacheDirectory: () => undefined,
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
  const dialogs = Array.from(document.body.querySelectorAll<HTMLElement>(".at-dialog-surface"));
  return dialogs[dialogs.length - 1];
};

/** 对话框 actions 里的最后一颗（确认键） */
const confirmOf = (surface: HTMLElement | undefined) => Array.from(
  surface?.querySelectorAll<HTMLButtonElement>(".at-dialog-actions button") ?? [],
).pop() ?? null;

describe("外壳 + 两个对话框：从行点进去，看的是哪个框、调的是哪个回调", () => {
  it("qd06_the_shell_renders_the_three_groups_and_the_card_header", () => {
    mountShell();
    expect(document.querySelectorAll(".settings-preference-group"), "三个子组没全渲染")
      .toHaveLength(3);
    const header = document.querySelector(".at-panel .settings-panel-header, .at-panel h3");
    expect(header, "卡片没有标题（与同页其它卡不同构）").not.toBeNull();
    expect((header?.textContent ?? "").trim(), "卡片标题是空的").not.toBe("");
    /* 未点任何键时一个对话框都不许冒出来 */
    expect(document.querySelectorAll(".at-dialog-surface"), "一进页面就有对话框").toHaveLength(0);
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

  it("qd09_the_activity_library_backup_and_restore_entries_are_gone", () => {
    /* 反向回归（批 5）：这两颗键、那三个框、以及它们赖以存在的组名都不许再出现。
       想加回来的人会先撞上这条，然后去读 `SettingsDataSafetyPanel` 顶部为什么删。 */
    mountShell();
    const text = document.body.textContent ?? "";
    expect(text, "「备份活动库」入口又回来了").not.toContain("备份活动库");
    expect(text, "「恢复活动库」入口又回来了").not.toContain("恢复活动库");
    expect(text, "「备份与恢复」组又回来了").not.toContain("备份与恢复");
    expect(text, "WebDAV 远端备份入口又回来了").not.toContain("远端备份");
    expect(document.querySelector(".settings-data-action-dialog"), "「选恢复来源」框又回来了").toBeNull();
    expect(document.querySelector(".at-segmented-filter"), "恢复策略选择器又回来了").toBeNull();
  });
});
