/**
 * TickBar — 倒计时默认时长的**唯一口径**（对齐 Timing v1.7.3 的「默认倒计时」设置）
 * -----------------------------------------------------------------------------
 * 参考版把这个值放在设置里（`ReferenceSettings::default_countdown_minutes`，默认 25 分钟），
 * 小条右键展开倒计时卡时显示的就是它。
 *
 * 历史坑：小条曾用「预设档位第一档」（= 5 分钟）当默认、卡片又自己回落 1500（= 25 分钟），
 * 两处不一致，用户看到的就是「打开倒计时，默认值忽大忽小」。这里收成一处。
 */

import type { ReferenceSettings } from '../types/domain';

/** 与 Rust `ReferenceSettings::default()` 保持一致 */
export const DEFAULT_COUNTDOWN_MINUTES = 25;

/** 参考设置非法 / 未加载时的兜底秒数 */
export const FALLBACK_COUNTDOWN_SEC = DEFAULT_COUNTDOWN_MINUTES * 60;

/** 滚轮调时长的步长（用户口径：一次 5 分钟） */
export const COUNTDOWN_STEP_SEC = 5 * 60;

/** 滚轮调时长的下界（5 分钟，短于此的倒计时没有实用意义） */
export const COUNTDOWN_MIN_SEC = 5 * 60;

/** 上界与 `stores/countdownArm.ts` 的 MAX_SEC 保持一致（90 分钟） */
export const COUNTDOWN_MAX_SEC = 90 * 60;

/** 把任意秒数夹到 [COUNTDOWN_MIN_SEC, COUNTDOWN_MAX_SEC] 并对齐到 5 分钟 */
export function clampCountdownSec(sec: number): number {
  if (!Number.isFinite(sec)) return FALLBACK_COUNTDOWN_SEC;
  const stepped = Math.round(sec / COUNTDOWN_STEP_SEC) * COUNTDOWN_STEP_SEC;
  if (stepped <= COUNTDOWN_MIN_SEC) return COUNTDOWN_MIN_SEC;
  return stepped >= COUNTDOWN_MAX_SEC ? COUNTDOWN_MAX_SEC : stepped;
}

/**
 * 取「默认倒计时时长」（秒）。
 * `referenceSettings` 未加载、字段缺失或非法时回落 25 分钟。
 */
export function defaultCountdownSec(reference: ReferenceSettings | null | undefined): number {
  const minutes = reference?.defaultCountdownMinutes;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1) {
    return FALLBACK_COUNTDOWN_SEC;
  }
  return Math.round(minutes) * 60;
}
