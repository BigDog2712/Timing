export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${minutes}m`;
  if (totalSeconds > 0) return `${totalSeconds}s`;
  return "0s";
}

/**
 * 秒 → `MM:SS`（满 1 小时转 `H:MM:SS`）—— 秒表口径。
 *
 * 与上面的 `formatDuration`（`2m` / `1h 5m` 那种「时长」口径）**不是一回事**，别互相替代：
 * 计时中/已计时的数字必须是每秒跳的秒表读数；而列表里的时长是可读概括（`HistoryTimingOverlap`
 * 一类的卡片用它）。P0-04 的标题栏胶囊与 P0-05 的弹卡都显示秒表读数，两处共用这一份，
 * 免得出现「胶囊 12:31、弹卡 12:30」这种同一个数字两种写法。
 */
export function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
