/**
 * 「完整数据包」（单个 JSON，含事项 / 计时 / 便利贴 / 待办 / 应用活动 / 手机端数据）的 IPC 口岸。
 *
 * 与 `importRuntimeGateway` / `dataExportGateway` 同一形状：`invoke` 之后**过一遍
 * 运行时校验**再交给 UI。理由没变——`invoke` 的返回是 `unknown`，一条命令改字段名时
 * 前端应该在口岸处就炸（带着命令名），而不是在渲染里出现 `undefined 行`。
 *
 * 后端契约（`src-tauri/src/commands/activity/bundle_cmd.rs`，格式串 `timing.full-bundle.v1`）：
 * 导出 `{ rowCount, tableCount, bytes }` / 预览 `{ format, exportedAtMs, appVersion,
 * deviceId, tables:[{name, rows}], totalRows, compatible, message }` /
 * 导入 `{ tables:[{name, inserted, updated, skipped}], totalInserted, totalUpdated }`。
 * 表名带库前缀（`business.items` / `activity.sessions`）——两个库里都有 `settings`。
 */
import { invoke } from "@tauri-apps/api/core";
import { isPlainRecord as isRecord } from "../../shared/lib/runtimeTypeGuards.ts";

export interface FullBundleExportSummary {
  rowCount: number;
  tableCount: number;
  bytes: number;
}

export interface FullBundleTableCount {
  name: string;
  rows: number;
}

export interface FullBundleInspect {
  format: string;
  exportedAtMs: number;
  appVersion: string;
  deviceId: string;
  tables: FullBundleTableCount[];
  totalRows: number;
  compatible: boolean;
  message: string;
}

export interface FullBundleTableStat {
  name: string;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface FullBundleImportSummary {
  tables: FullBundleTableStat[];
  totalInserted: number;
  totalUpdated: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTableCount(value: unknown): value is FullBundleTableCount {
  return isRecord(value) && typeof value.name === "string" && isFiniteNumber(value.rows);
}

function isTableStat(value: unknown): value is FullBundleTableStat {
  return isRecord(value)
    && typeof value.name === "string"
    && isFiniteNumber(value.inserted)
    && isFiniteNumber(value.updated)
    && isFiniteNumber(value.skipped);
}

export function parseExportSummary(value: unknown): FullBundleExportSummary {
  if (!isRecord(value)
    || !isFiniteNumber(value.rowCount)
    || !isFiniteNumber(value.tableCount)
    || !isFiniteNumber(value.bytes)) {
    throw new Error("Received invalid full bundle export payload");
  }
  return value as unknown as FullBundleExportSummary;
}

export function parseInspect(value: unknown): FullBundleInspect {
  if (!isRecord(value)
    || typeof value.format !== "string"
    || typeof value.appVersion !== "string"
    || typeof value.deviceId !== "string"
    || typeof value.message !== "string"
    || typeof value.compatible !== "boolean"
    || !isFiniteNumber(value.exportedAtMs)
    || !isFiniteNumber(value.totalRows)
    || !Array.isArray(value.tables)
    || !value.tables.every(isTableCount)) {
    throw new Error("Received invalid full bundle preview payload");
  }
  return value as unknown as FullBundleInspect;
}

export function parseImportSummary(value: unknown): FullBundleImportSummary {
  if (!isRecord(value)
    || !isFiniteNumber(value.totalInserted)
    || !isFiniteNumber(value.totalUpdated)
    || !Array.isArray(value.tables)
    || !value.tables.every(isTableStat)) {
    throw new Error("Received invalid full bundle import payload");
  }
  return value as unknown as FullBundleImportSummary;
}

export function pickFullBundleSaveFile(): Promise<string | null> {
  return invoke("cmd_pick_full_bundle_save_file");
}

export async function exportFullBundle(outputPath: string): Promise<FullBundleExportSummary> {
  return parseExportSummary(await invoke("cmd_export_full_bundle", { outputPath }));
}

export function pickFullBundleFile(): Promise<string | null> {
  return invoke("cmd_pick_full_bundle_file");
}

export async function inspectFullBundle(path: string): Promise<FullBundleInspect> {
  return parseInspect(await invoke("cmd_inspect_full_bundle", { path }));
}

export async function importFullBundle(path: string): Promise<FullBundleImportSummary> {
  return parseImportSummary(await invoke("cmd_import_full_bundle", { path }));
}
