/**
 * Patina（分析窗）→ 宿主的**数据与同步写面**（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 按域拆文件的理由：T04a 那份 `hostSettingsGateway.ts` 已经 120 行贴线，md_sync / md_backup /
 * data_root 再加进去会变成一个什么都干的巨文件。这里只放「计时数据的同步、备份与落点」，
 * 主题与设置留在 `hostSettingsGateway.ts`，插件在 `hostPluginsGateway.ts`。
 *
 * 命令名与宿主 `IpcApi`（`src/types/domain/ipc.ts`）逐字对齐，权限见
 * `src-tauri/permissions/activity-host-settings.toml`。出错一律 throw（带 `message`），
 * 由 `features/settings/services/hostApi.ts` 的 `errorText` 转成给用户看的一句话。
 */
import { invoke } from "@tauri-apps/api/core";
import { asHostError } from "./hostCommandError.ts";
import type {
  DataRootInfo,
  Decision,
  MdBackupExport,
  MdBackupItem,
  MdBackupRestoreResult,
  MdPendingConflict,
  MdResolveOutcome,
  MdSyncConfig,
  MdSyncKind,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
  SafStatus,
} from "../../../shared/dto/hostTypes";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 宿主 `AppError` 序列化形状 `{ code, message }` → 带 `message` 的 Error（码挂在 `code` 上）。
 *  实现已收口到 `hostCommandError.ts`：四个网关共用一份，别再复制第五份——0.12.5 的
 *  「操作失败，请重试」就是这么来的（两个网关认这个形状，另外两个没认）。 */
export type { HostCommandError } from "./hostCommandError.ts";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error("当前不在桌面宿主里，这条同步命令不可用");
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw asHostError(raw);
  }
}

/* ---- Markdown 同步 ---- */
export function mdSyncGet(): Promise<MdSyncViewCloud> {
  return call<MdSyncViewCloud>("md_sync_get");
}

export function mdSyncSave(config: MdSyncConfig, secret?: string | null): Promise<MdSyncViewCloud> {
  return call<MdSyncViewCloud>("md_sync_save", { config, secret: secret ?? null });
}

export function mdSyncRun(): Promise<MdSyncReport> {
  return call<MdSyncReport>("md_sync_run");
}

export function mdSyncDecisions(): Promise<MdPendingConflict[]> {
  return call<MdPendingConflict[]>("md_sync_decisions");
}

export function mdSyncResolve(id: string, decision: Decision): Promise<MdResolveOutcome> {
  return call<MdResolveOutcome>("md_sync_resolve", { id, decision });
}

export function mdSyncOpen(kind: MdSyncKind): Promise<void> {
  return call<void>("md_sync_open", { kind });
}

export function mdSyncTest(config: MdSyncConfig, secret?: string | null): Promise<MdSyncTestResult> {
  return call<MdSyncTestResult>("md_sync_test", { config, secret: secret ?? null });
}

/* ---- 备份 ---- */
export function mdBackupList(): Promise<MdBackupItem[]> {
  return call<MdBackupItem[]>("md_backup_list");
}

export function mdBackupRestore(
  name: string,
  target?: string | null,
): Promise<MdBackupRestoreResult> {
  return call<MdBackupRestoreResult>("md_backup_restore", { name, target: target ?? null });
}

export function mdBackupOpen(name: string): Promise<void> {
  return call<void>("md_backup_open", { name });
}

export function mdBackupExport(name: string): Promise<MdBackupExport> {
  return call<MdBackupExport>("md_backup_export", { name });
}

/* ---- 手机端 SAF 目录（桌面不挂这两个面；留着是为了函数表与宿主 `IpcApi` 对齐） ---- */
export function mdSafPick(): Promise<SafStatus> {
  return call<SafStatus>("md_saf_pick");
}

export function mdSafStatus(): Promise<SafStatus> {
  return call<SafStatus>("md_saf_status");
}

/* ---- 数据根（`change(null)` = 撤销待生效的切换，**不是**没传参） ---- */
export function dataRootGet(): Promise<DataRootInfo> {
  return call<DataRootInfo>("data_root_get");
}

export function dataRootChange(path?: string | null): Promise<DataRootInfo> {
  return call<DataRootInfo>("data_root_change", { path: path ?? null });
}

export function dataRootOpen(): Promise<void> {
  return call<void>("data_root_open");
}

/* ---- 旧版迁移信息（数据管理面顶部那一条） ---- */
export function getMigrationInfo(): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("get_migration_info");
}

export function openLegacyDir(): Promise<void> {
  return call<void>("open_legacy_dir");
}

/* ---- 每日待办状态（工具页用过；设置在「数据与同步」里只读展示） ---- */
export function dailyStatusGet(date: string): Promise<Record<number, "pending" | "done">> {
  return call<Record<number, "pending" | "done">>("daily_status_get", { date });
}

export function dailyStatusSet(
  date: string,
  itemId: number,
  status: "pending" | "done",
): Promise<void> {
  return call<void>("daily_status_set", { date, itemId, status });
}
