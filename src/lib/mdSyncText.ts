/**
 * Timing — 同步结果的「人话」（[V0.11.30] 从 `SyncPane` 抽出来共用）
 * -----------------------------------------------------------------------------
 * 两处要用：设置页的「立即同步」、计时页新加的快捷同步按钮。抽出来不是因为洁癖，
 * 而是这两句文案**有刻意的取舍**，各写一份必然有一天分叉：
 *
 * - `syncErrorText` 不用 `errorText()` 的润色：它把 `IO_ERROR` 统一说成「系统调用失败，请重试」，
 *   而手机上的失败大多来自原生桥或网络，后端原文（「云端 401…」/「原生桥 … 失败：…」）
 *   恰好是唯一能定位问题的线索。
 * - `syncReportText` 的顺序是「错误 → 导入 → 导出 → 无事发生」：有错误时别用「已写入文件」
 *   盖住它，用户会以为成功了。
 */
import { errorText, IpcError } from '../services/ipc';
import type { MdSyncReport } from '../types/domain';

/** 同步失败时的原文（后端说了什么就说什么）。 */
export function syncErrorText(err: unknown): string {
  if (err instanceof IpcError && err.message) return err.message;
  return errorText(err);
}

/** 一次同步的结果 → 一句话。 */
export function syncReportText(report: MdSyncReport): string {
  if (report.errors.length > 0) return report.errors.join('；');
  if (report.imported > 0) return `已从文件读回 ${report.imported} 条改动`;
  if (report.exported > 0) return '已写入文件';
  return '没有需要同步的改动';
}
