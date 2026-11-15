(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";

/**
 * 「数据安全」卡的 **`busy` 汇总口径 + 四颗动作键的接线**（面板级）。
 *
 * [设置页七项改造·批 5] 「活动库备份与恢复」整块下线后，`busy` 的来源从七项收窄到两项：
 *   `isStorageBusy`（目录快照 / 迁移）、`isImportBusy`（导入）。
 * 这两项任一项为真时，本卡**所有**动作键都必须禁用 —— 漏一项就是"导入一半又去搬目录"。
 * 清理自己的运行态（`isCleaning`）单独门控清理那一组、不进 `busy`：清理跑着的时候
 * 目录键仍可点（两件事不写同一行），但清理键自己要显示「正在清理」。
 *
 * 判据一律用**用户能看见的东西**：`.settings-preference-control button` 的 `disabled`
 * 与文案；行标题取自 zh-CN 真实文案，不手抄近似值。
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

/** zh-CN 里这四行动作键的行标题（= 用户屏幕上看到的字，不是类名） */
const ACTION_ROW_TITLES = [
  "数据导出",
  "导入",
  "清理缓存",
  "清理历史记录",
] as const;

type Overrides = Partial<Parameters<typeof SettingsDataSafetyPanel>[0]>;

let container: HTMLDivElement;
let root: Root;
const cb = {
  onCleanup: vi.fn<() => void>(),
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
        isCleaning: false,
        onCleanupRangeChange: rangeChange as never,
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
        ...overrides,
      }),
    }));
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
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

/** `busy` 的两项来源，逐个打开 */
const BUSY_SOURCES: [string, Overrides][] = [
  ["isStorageBusy", { isStorageBusy: true }],
  ["isImportBusy", { isImportBusy: true }],
];

describe("「数据安全」卡的 busy 汇总口径（两项，逐个验）", () => {
  it("qd10_idle_renders_three_groups_and_four_clickable_action_keys", () => {
    mount();
    expect(document.querySelectorAll(".settings-preference-group"), "三个子组没全渲染").toHaveLength(3);
    for (const title of ACTION_ROW_TITLES) {
      const key = actionKey(title);
      expect(key, `空闲态找不到「${title}」那一行的按钮（标题 + 右侧控件）`).not.toBeNull();
      expect(key?.disabled, `空闲态「${title}」是禁用的（永久禁用）`).toBe(false);
    }
  });

  it.each(BUSY_SOURCES)("qd11_busy_from_%s_disables_every_action_key", (name, patch) => {
    /* 任何一条长任务在跑 → 四颗动作键全部禁用。漏一项就是"导入的同时点了搬目录"。 */
    mount(patch);
    for (const title of ACTION_ROW_TITLES) {
      const key = actionKey(title);
      expect(key, `[${name}] 找不到「${title}」的按钮`).not.toBeNull();
      expect(key?.disabled, `[${name}] 时「${title}」仍可点（busy 汇总漏了这一项）`).toBe(true);
    }
  });

  it("qd11b_cleaning_does_not_flip_the_busy_aggregate", () => {
    /* 清理跑着的时候：清理键自己禁用并换成「正在清理」，但它**不进** busy ——
       其余动作键仍可点（清理与导出不写同一行）。 */
    mount({ isCleaning: true });
    expect(actionKey("清理历史记录")?.disabled, "清理进行中仍可再次发起清理").toBe(true);
    expect(actionKey("清理历史记录")?.textContent ?? "").toContain("正在清理");
    expect(actionKey("数据导出")?.disabled, "清理被误算进 busy（导出键也跟着灰了）").toBe(false);
  });
});

describe("四颗动作键的接线（点了调的是哪个回调）", () => {
  it("qd12_export_and_import_keys_call_their_own_callbacks", async () => {
    mount();
    act(() => { actionKey("数据导出")?.click(); });
    await flush();
    expect(cb.onOpenDataExport, "「数据导出」没接到 onOpenDataExport").toHaveBeenCalledTimes(1);
    expect(cb.onOpenDataImport, "点导出却调了导入").not.toHaveBeenCalled();

    act(() => { actionKey("导入")?.click(); });
    await flush();
    expect(cb.onOpenDataImport, "「导入」没接到 onOpenDataImport").toHaveBeenCalledTimes(1);
    expect(cb.onOpenDataExport).toHaveBeenCalledTimes(1);
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
    const surface = Array.from(document.body.querySelectorAll<HTMLElement>(".at-dialog-surface")).pop();
    expect(surface, "「清理缓存」没有确认框").toBeDefined();
    expect(surface?.textContent ?? "", "确认框里没有「重启并应用」").toContain("重启并应用");
  });
});
