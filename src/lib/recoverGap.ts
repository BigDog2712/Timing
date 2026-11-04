/**
 * TickBar — 崩溃恢复的「退出期间」换算（V0.4.2）
 * -----------------------------------------------------------------------------
 * 用户口径：被强制退出的事项，可选择退出期间是否并入计时。
 *
 * 空档 = `running_since`（最后一次落盘的锚点）→ 现在。这个值**只是给人看的提示**：
 * 真正的补偿在后端 `services::timer::gap_sec`，两者的判据必须一致——
 *   1. 当时正在跑（`runningSince != null`）；暂停中没有流逝，补了等于把暂停算成工作；
 *   2. 空档 > 0（墙钟回拨时不让用户看到负数）；
 *   3. 不足 1 分钟就不问（`RECOVER_GAP_MIN_SEC`）：为 20 秒弹一个选项比不补更烦人，
 *      后端此时也会算出 20 秒——但前端不提供入口，等于按 R-2 处理。
 */
import type { TimeRecord } from '../types/domain';

/** 空档短于这个长度就不问用户（见文件头第 3 条） */
export const RECOVER_GAP_MIN_SEC = 60;

/** 退出期间可并入的秒数；不可并入时返回 0 */
export function recoverGapSec(session: TimeRecord, now: number): number {
  if (session.runningSince == null) return 0;
  return Math.max(0, Math.floor((now - session.runningSince) / 1000));
}

/** 是否值得让用户为这段空档做一次决定 */
export function shouldAskGap(gapSec: number): boolean {
  return gapSec >= RECOVER_GAP_MIN_SEC;
}
