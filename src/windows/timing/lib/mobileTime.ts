/**
 * Timing — 记录编辑的时间输入换算（纯函数，无 DOM）
 * -----------------------------------------------------------------------------
 * `<input type="datetime-local">` 的值是「本地时区、无时区后缀」的 `YYYY-MM-DDTHH:mm`，
 * 后端与 DTO 一律是 epoch ms。两端换算集中在这里，避免各组件自己拼字符串
 * （拼错一位就是把记录挪到 8 小时外——手机上没人会去核对）。
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** epoch ms → `YYYY-MM-DDTHH:mm`（本地时区，含秒被截断：界面只编辑到分钟） */
export function toDateTimeInput(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * `YYYY-MM-DDTHH:mm` → epoch ms（本地时区）。
 * 空串 / 非法值返回 null，调用方据此报「时间不合法」而不是写成 NaN。
 */
export function fromDateTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 分钟 → 秒；用于倒计时输入（上限 24h 由后端 INVALID_TARGET_SEC 兜底） */
export function minutesToSec(minutes: number): number {
  return Math.round(minutes * 60);
}
