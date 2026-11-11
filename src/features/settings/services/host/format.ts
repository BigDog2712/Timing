/**
 * 分析窗侧的时长格式化（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 只有 `formatMinutes` 一个函数被搬来的插件面板用到（`lib/format.ts` 属主窗，L9 禁跨窗 import）。
 * **行为与宿主逐字一致**：不足 1 分钟给 `<1m`，不足 1 小时给 `Nm`，否则 `Hh` / `HhMm`。
 * 改一处必须两处同改；漂移由 `src/features/settings/services/host/format.test.ts` 的固定向量钉住。
 */
const SEC_PER_MIN = 60;

/** 负值 / NaN 一律当 0（与宿主 `clampSeconds` 同口径）。 */
function clampSeconds(totalSec: number): number {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return 0;
  return Math.floor(totalSec);
}

export function formatMinutes(totalSec: number): string {
  const sec = clampSeconds(totalSec);
  if (sec < SEC_PER_MIN) return "<1m";
  const totalMin = Math.round(sec / SEC_PER_MIN);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
