import type { ExportFormat, ExportRangeMode } from "./settingsDataExportRange.ts";
import {
  DATA_EXPORT_PROTOCOL_FIELDS,
  isDataExportProtocolField,
  type DataExportProtocolField,
} from "../../../platform/persistence/dataExportGateway.ts";
import {
  exportFieldsSlot,
  readActivityKey,
  readActivitySlot,
  writeActivityKey,
  writeActivitySlot,
} from "../../../../shared/activityStorageKeys";

/* [T04-4] 键名从注册表取（老键字面量只住 activityStorageKeys.ts）；
   读写走出口（先过迁移闸）。export-fields 用动态模板槽：注册表建成之后
   才出现的第 5 个导出格式也天然被覆盖（§3.2）。存储不可用的空值语义
   （读得 null / 写返回 false）由出口自带，本文件原来的 getBrowserLocalStorage
   判空因此删除。 */

const DEFAULT_EXPORT_RANGE_MODE: ExportRangeMode = "month";
const DEFAULT_EXPORT_FORMAT: ExportFormat = "csv";

function isExportRangeMode(value: string | null): value is ExportRangeMode {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

function isExportFormat(value: string | null): value is ExportFormat {
  return value === "csv" || value === "sqlite" || value === "parquet" || value === "markdown";
}

function exportFieldsSlotOf(format: ExportFormat) {
  return exportFieldsSlot(format);
}

export function normalizeExportFields(
  value: unknown,
  fallback: readonly DataExportProtocolField[],
): DataExportProtocolField[] {
  const source = Array.isArray(value) ? value : fallback;
  const selected = new Set(source
    .filter((field): field is string => typeof field === "string")
    .filter(isDataExportProtocolField));
  const normalized = DATA_EXPORT_PROTOCOL_FIELDS.filter((field) => selected.has(field));
  if (normalized.length > 0) return normalized;
  const fallbackSet = new Set(fallback);
  return DATA_EXPORT_PROTOCOL_FIELDS.filter((field) => fallbackSet.has(field));
}

export function readExportFields(
  format: ExportFormat,
  fallback: readonly DataExportProtocolField[],
): DataExportProtocolField[] {
  try {
    const raw = readActivitySlot(exportFieldsSlotOf(format));
    return raw ? normalizeExportFields(JSON.parse(raw), fallback) : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function rememberExportFields(format: ExportFormat, fields: readonly string[]) {
  try {
    const normalized = normalizeExportFields(fields, DATA_EXPORT_PROTOCOL_FIELDS);
    writeActivitySlot(exportFieldsSlotOf(format), JSON.stringify(normalized));
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
}

export function readExportRangeMode(): ExportRangeMode {
  try {
    const value = readActivityKey("exportRangeMode");
    return isExportRangeMode(value) ? value : DEFAULT_EXPORT_RANGE_MODE;
  } catch {
    return DEFAULT_EXPORT_RANGE_MODE;
  }
}

export function rememberExportRangeMode(mode: ExportRangeMode) {
  try {
    writeActivityKey("exportRangeMode", mode);
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
}

export function readExportFormat(): ExportFormat {
  try {
    const value = readActivityKey("exportFormat");
    return isExportFormat(value) ? value : DEFAULT_EXPORT_FORMAT;
  } catch {
    return DEFAULT_EXPORT_FORMAT;
  }
}

export function rememberExportFormat(format: ExportFormat) {
  try {
    writeActivityKey("exportFormat", format);
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
}
