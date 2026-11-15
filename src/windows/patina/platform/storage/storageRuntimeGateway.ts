import { invoke } from "@tauri-apps/api/core";

interface StoragePathSnapshot {
  installDir: string;
  /** Timing 真正的数据根（`%APPDATA%\com.timing.app`）：计时库 / md / logs / plugins / patina 都在它下面。 */
  timingDataRoot: string;
  /** 活动库那一层（`<timingDataRoot>/patina/data`）；SQLite 落点设置改的是它。 */
  dataRoot: string;
  databasePath: string;
  backupDir: string;
  remoteBackupTempDir: string;
  webviewRoot: string;
  isCustomDataRoot: boolean;
  isCustomWebviewRoot: boolean;
}

interface StorageSizeSnapshot {
  installDirSizeBytes: number;
  /** `dataRoot` 里 sqlite 家族三个文件的合计。 */
  dataSizeBytes: number;
  /** `timingDataRoot` 的**递归**体积（设置页「数据目录」那一行读的就是它）。 */
  timingDataSizeBytes: number;
  backupDirSizeBytes: number;
}

interface WebviewCacheEntrySnapshot {
  label: string;
  path: string;
  sizeBytes: number;
}

interface WebviewCacheSnapshot {
  webviewRoot: string;
  ebwebviewPath: string;
  totalSizeBytes: number;
  reclaimableSizeBytes: number;
  lastTrimAtMs: number | null;
  entries: WebviewCacheEntrySnapshot[];
}

interface StorageMaintenanceSnapshot {
  lastError: string | null;
}

export interface StorageSnapshot {
  paths: StoragePathSnapshot;
  sizes: StorageSizeSnapshot;
  webviewCache: WebviewCacheSnapshot;
  maintenance: StorageMaintenanceSnapshot;
}

export interface StorageMigrationPreview {
  currentDataRoot: string;
  targetDataRoot: string;
  currentWebviewRoot: string;
  targetWebviewRoot: string;
  databaseSizeBytes: number;
  backupDirSizeBytes: number;
  webviewCacheReclaimableBytes: number;
  requiresRestart: boolean;
}

export async function getStorageSnapshot(): Promise<StorageSnapshot> {
  return invoke<StorageSnapshot>("cmd_get_storage_snapshot");
}

export async function pickStorageDirectory(): Promise<string | null> {
  return invoke<string | null>("cmd_pick_storage_directory");
}

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 选一个 Markdown 文件（设置 → 同步 → 日记模板路径的「选择文件…」）。
 *
 * 三种「没选到」都返回 `null`：浏览器 mock 里没有原生对话框、用户点了取消、命令报错。
 * 调用方据此**保留输入框原值**——把取消写成空串等于「点一下取消就清空模板」。
 */
export async function pickMarkdownFile(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const selected = await invoke<string | null>("cmd_pick_markdown_file");
    return selected && selected.trim() ? selected : null;
  } catch (error) {
    console.error("pick markdown file failed", error);
    return null;
  }
}

export async function previewStorageMigration(targetDataRoot: string): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_storage_migration", { targetDataRoot });
}

export async function previewWebviewCacheMigration(targetWebviewRoot: string): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_webview_cache_migration", { targetWebviewRoot });
}

export async function previewRestoreDefaultStorageMigration(): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_restore_default_storage_migration");
}

export async function previewRestoreDefaultWebviewCacheMigration(): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_restore_default_webview_cache_migration");
}

export async function restartAndApplyStorageMigration(targetDataRoot: string): Promise<void> {
  await invoke("cmd_restart_and_apply_storage_migration", { targetDataRoot });
}

export async function restartAndApplyWebviewCacheMigration(targetWebviewRoot: string): Promise<void> {
  await invoke("cmd_restart_and_apply_webview_cache_migration", { targetWebviewRoot });
}

export async function restartAndApplyRestoreDefaultStorageMigration(): Promise<void> {
  await invoke("cmd_restart_and_apply_restore_default_storage_migration");
}

export async function restartAndApplyRestoreDefaultWebviewCacheMigration(): Promise<void> {
  await invoke("cmd_restart_and_apply_restore_default_webview_cache_migration");
}

export async function restartAndClearWebviewCache(): Promise<void> {
  await invoke("cmd_restart_and_clear_webview_cache");
}

export async function openStorageDirectory(path: string): Promise<void> {
  await invoke("cmd_open_storage_directory", { path });
}
