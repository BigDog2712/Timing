/**
 * 「完整数据包」这一行的全部文案 —— **本地 copy 常量，不进 i18n**。
 *
 * 原因：i18n 是位置数组，本轮冻结在 939 键（`settingsConvergence.source.test.ts` 有
 * 硬断言）。往数组里插一个键会让所有语言文件整体错位，代价远大于收益。等功能定稿
 * 再统一补翻译——那时这里是唯一需要改的地方。
 */
import type { FullBundleInspect, FullBundleTableStat } from "../../../platform/persistence/fullBundleRuntimeGateway.ts";

export const FULL_BUNDLE_TITLE = "完整数据包（JSON）";
/**
 * 现有「数据导出」对话框只导活动库（应用使用记录）——它的标题/hint 一直是这么写的，
 * 但用户看到「数据导出」四个字很容易以为全都在里面。这句是补上去的注脚，不是新功能。
 */
export const ACTIVITY_ONLY_NOTE =
  "这里的导出只含活动数据（应用使用记录）；事项、计时、便利贴、待办与手机端数据在「完整数据包」里";
export const FULL_BUNDLE_EXPORT_HINT =
  "包含事项、计时、便利贴、待办、应用活动与手机端数据；导出为单个 JSON 文件";
export const FULL_BUNDLE_EXPORT_ACTION = "导出…";
export const FULL_BUNDLE_EXPORTING = "导出中…";

export const FULL_BUNDLE_IMPORT_HINT =
  "从单个 JSON 包合并回来：不清空、不覆盖本地已有数据，重复导入同一份不会再长行";
export const FULL_BUNDLE_IMPORT_ACTION = "导入…";
export const FULL_BUNDLE_IMPORTING = "导入中…";
export const FULL_BUNDLE_IMPORT_DIALOG_TITLE = "导入完整数据包";
export const FULL_BUNDLE_IMPORT_RESULT_TITLE = "导入结果";
/** 用户最需要提前知道的一件事：统计图不在导入那一刻就一致。 */
export const FULL_BUNDLE_RESTART_NOTE = "统计图与时间轴要等**重启后**才完全一致（读模型要重算）。";
export const FULL_BUNDLE_INCOMPATIBLE_NOTE = "这个包与本机版本不兼容，只能看，不能导入。";
export const FULL_BUNDLE_RULE_LABEL = "合并规则";
export const FULL_BUNDLE_RULE_TEXT =
  "按 uid 合并（同一条记录只更新不重复）；没有 uid 的表按本地已有则跳过。";
export const FULL_BUNDLE_SKIPPED_LABEL = "跳过";

export function fullBundleExported(rows: number, bytes: number): string {
  return `已导出 ${rows} 行 · ${formatBytes(bytes)}`;
}

export function fullBundleExportFailed(message: string): string {
  return `导出失败：${message}`;
}

export function fullBundleImported(inserted: number, updated: number): string {
  return `已导入：新增 ${inserted} 行 / 更新 ${updated} 行`;
}

export function fullBundleSourceLine(inspect: FullBundleInspect): string {
  const at = formatAt(inspect.exportedAtMs);
  const device = inspect.deviceId.trim() || "未知设备";
  return `${inspect.appVersion} · ${device} · ${at}`;
}

export function fullBundleTableRow(stat: FullBundleTableStat): string {
  return `新增 ${stat.inserted} / 更新 ${stat.updated} / 跳过 ${stat.skipped}`;
}

/** 人读的字节数。三位有效数字够用：用户只关心「12 KB」还是「2.3 MB」。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "未知时间";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString();
}
