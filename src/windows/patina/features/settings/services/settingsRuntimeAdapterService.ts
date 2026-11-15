import { parseCommandError } from "../../../platform/persistence/commandError.ts";
import {
  clearSessionsBefore,
  saveAppSettingsPatch,
  saveAppSetting,
  type AppSettings,
  type AppSettingsPatch,
} from "../../../platform/persistence/appSettingsStore.ts";
import { openExternalUrl } from "../../../platform/desktop/externalUrlGateway.ts";
import {
  getStorageSnapshot,
  openStorageDirectory,
  pickStorageDirectory,
  previewRestoreDefaultStorageMigration,
  previewRestoreDefaultWebviewCacheMigration,
  previewStorageMigration,
  previewWebviewCacheMigration,
  restartAndApplyRestoreDefaultWebviewCacheMigration,
  restartAndApplyRestoreDefaultStorageMigration,
  restartAndApplyStorageMigration,
  restartAndApplyWebviewCacheMigration,
  restartAndClearWebviewCache,
  type StorageMigrationPreview,
  type StorageSnapshot,
} from "../../../platform/storage/storageRuntimeGateway.ts";
import {
  emitAppSettingsChanged,
  onAppSettingsChanged,
} from "../../../platform/runtime/appSettingsEventGateway.ts";
import { setAfkThreshold } from "../../../platform/runtime/trackingRuntimeGateway.ts";

import type { CleanupRange } from "../types.ts";
import {
  clearSessionsByRangeWithDeps,
} from "./sessionCleanupPolicy.ts";

export type { StorageMigrationPreview, StorageSnapshot } from "../../../platform/storage/storageRuntimeGateway.ts";

type SettingsPatch = Partial<AppSettings>;
export interface SettingsCommitResult {
  persisted: boolean;
  runtimeSync: "synced" | "failed" | "not-needed";
  runtimeSyncErrors: string[];
}

interface SettingsCommitDeps {
  persistPatch: (patch: SettingsPatch) => Promise<void>;
  syncTimelineMergeGap: (seconds: number) => Promise<void>;
  notifySettingsChanged: (patch: SettingsPatch) => Promise<void>;
}
const RELEASE_NOTES_URL = "https://github.com/Ceceliaee/patina/releases";
const REPOSITORY_URL = "https://github.com/Ceceliaee/patina";
const FEEDBACK_URL = "https://github.com/Ceceliaee/patina/issues/new/choose";
const KOFI_SUPPORT_URL = "https://ko-fi.com/ceceliaee";

const defaultSettingsCommitDeps: SettingsCommitDeps = {
  persistPatch: saveAppSettingsPatch,
  syncTimelineMergeGap: setAfkThreshold,
  notifySettingsChanged: emitAppSettingsChanged,
};

export class SettingsRuntimeAdapterService {
  static async subscribeSettingsChanged(handler: () => void | Promise<void>): Promise<() => void> {
    return onAppSettingsChanged(handler);
  }

  static async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    await saveAppSetting(key, value);

    if (key === "timelineMergeGapSecs") {
      await setAfkThreshold(value as number);
    }
  }

  static async clearSessionsByRange(range: CleanupRange, nowMs: number = Date.now()): Promise<void> {
    await clearSessionsByRangeWithDeps(range, nowMs, {
      clearSessionsBefore,
    });
  }

  static async openReleaseNotes(): Promise<void> {
    await openExternalUrl(RELEASE_NOTES_URL);
  }

  static async openRepository(): Promise<void> {
    await openExternalUrl(REPOSITORY_URL);
  }

  static async openFeedback(): Promise<void> {
    await openExternalUrl(FEEDBACK_URL);
  }

  static async openKofiSupport(): Promise<void> {
    await openExternalUrl(KOFI_SUPPORT_URL);
  }

  static async getStorageSnapshot(): Promise<StorageSnapshot> {
    return getStorageSnapshot();
  }

  static async pickStorageDirectory(): Promise<string | null> {
    return pickStorageDirectory();
  }

  static async previewStorageMigration(path: string): Promise<StorageMigrationPreview> {
    return previewStorageMigration(path);
  }

  static async previewWebviewCacheMigration(path: string): Promise<StorageMigrationPreview> {
    return previewWebviewCacheMigration(path);
  }

  static async previewRestoreDefaultStorageMigration(): Promise<StorageMigrationPreview> {
    return previewRestoreDefaultStorageMigration();
  }

  static async previewRestoreDefaultWebviewCacheMigration(): Promise<StorageMigrationPreview> {
    return previewRestoreDefaultWebviewCacheMigration();
  }

  static async restartAndApplyStorageMigration(path: string): Promise<void> {
    await restartAndApplyStorageMigration(path);
  }

  static async restartAndApplyWebviewCacheMigration(path: string): Promise<void> {
    await restartAndApplyWebviewCacheMigration(path);
  }

  static async restartAndApplyRestoreDefaultStorageMigration(): Promise<void> {
    await restartAndApplyRestoreDefaultStorageMigration();
  }

  static async restartAndApplyRestoreDefaultWebviewCacheMigration(): Promise<void> {
    await restartAndApplyRestoreDefaultWebviewCacheMigration();
  }

  static async restartAndClearWebviewCache(): Promise<void> {
    await restartAndClearWebviewCache();
  }

  static async openStorageDirectory(path: string): Promise<void> {
    await openStorageDirectory(path);
  }

  static buildSettingsPatch(
    saved: AppSettings,
    draft: AppSettings,
  ): SettingsPatch {
    const patch: SettingsPatch = {};
    const patchRecord = patch as Record<keyof AppSettings, AppSettings[keyof AppSettings]>;
    const keys = Object.keys(saved) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (saved[key] !== draft[key]) {
        patchRecord[key] = draft[key];
      }
    }
    return patch;
  }

  static async commitSettingsPatch(patch: SettingsPatch): Promise<SettingsCommitResult> {
    return commitSettingsPatchWithDeps(patch, defaultSettingsCommitDeps);
  }
}

export async function commitSettingsPatchWithDeps(
  patch: SettingsPatch,
  deps: SettingsCommitDeps,
): Promise<SettingsCommitResult> {
  const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
  if (entries.length === 0) {
    return {
      persisted: true,
      runtimeSync: "not-needed",
      runtimeSyncErrors: [],
    };
  }

  const runtimeSyncErrors: string[] = [];
  try {
    await deps.persistPatch(patch as AppSettingsPatch);
  } catch (error) {
    const commandError = parseCommandError(error);
    if (commandError.code !== "SETTINGS_APPLY_FAILED" && commandError.code !== "SETTINGS_EVENT_FAILED") {
      throw error;
    }
    // These command errors occur only after the transaction has committed.
    runtimeSyncErrors.push(commandError.message);
  }
  try {
    await deps.notifySettingsChanged(patch);
  } catch (error) {
    runtimeSyncErrors.push(error instanceof Error ? error.message : String(error));
  }

  const timelineMergeGapSecs = patch.timelineMergeGapSecs;
  const needsRuntimeSync = typeof timelineMergeGapSecs === "number";
  if (needsRuntimeSync) {
    try {
      await deps.syncTimelineMergeGap(timelineMergeGapSecs);
    } catch (error) {
      runtimeSyncErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    persisted: true,
    runtimeSync: runtimeSyncErrors.length > 0
        ? "failed"
        : needsRuntimeSync
          ? "synced"
          : "not-needed",
    runtimeSyncErrors,
  };
}
