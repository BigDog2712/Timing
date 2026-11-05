/**
 * Timing — 时长 / 时间格式化（唯一出口）
 * -----------------------------------------------------------------------------
 * 契约（Spec §10 边界值 + IPC-CONTRACT-v2 §计时展示）：
 *   - 时长 < 1h  -> `MM:SS`（min-width 5ch）
 *   - 时长 >= 1h -> `HH:MM:SS`（min-width 8ch，两位小时）
 *   - 上限 `99:59:59`，超过后冻结显示（不溢出布局）
 * 任何组件需要展示时长/时刻，一律经本文件，禁止就地拼字符串。
 */

/** 常用常量：秒/分/时 */
const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;
const MAX_DISPLAY_SEC = 99 * SEC_PER_HOUR + 59 * SEC_PER_MIN + 59; // 99:59:59

/** 两位补零 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 归一化到 [0, MAX_DISPLAY_SEC] 的整数秒 */
export function clampSeconds(totalSec: number): number {
  if (!Number.isFinite(totalSec)) return 0;
  const floored = Math.floor(totalSec);
  if (floored <= 0) return 0;
  return floored > MAX_DISPLAY_SEC ? MAX_DISPLAY_SEC : floored;
}

/**
 * 时长格式化：`<1h` -> `MM:SS`；`>=1h` -> `HH:MM:SS`。
 * 输入为秒（向下取整），负值归零。
 */
export function formatDuration(totalSec: number): string {
  const sec = clampSeconds(totalSec);
  const h = Math.floor(sec / SEC_PER_HOUR);
  const m = Math.floor((sec % SEC_PER_HOUR) / SEC_PER_MIN);
  const s = sec % SEC_PER_MIN;
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

/** 是否达到「跨小时」档（驱动 .timer-digits[data-hours="true"] 的 8ch 定宽） */
export function hasHours(totalSec: number): boolean {
  return clampSeconds(totalSec) >= SEC_PER_HOUR;
}

/**
 * 时刻格式化：epoch 毫秒 -> `HH:MM`（24 小时制，本地时区）。
 * 用于记录明细行「开始时间」与恢复对话框「开始于 09:12」。
 */
export function formatClockTime(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '--:--';
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 记录行「开始 - 结束」显示：`09:12 - 09:47`。
 * 结束为空（active 会话）时显示「进行中」。
 */
export function formatRange(startedAt: number, endedAt: number | null): string {
  const start = formatClockTime(startedAt);
  if (endedAt == null) return `${start} - 进行中`;
  return `${start} - ${formatClockTime(endedAt)}`;
}

/**
 * 事项名截断：超过 maxChars 个字符则截断并追加省略号。
 * 规则（pill-bar.md）：保留**开头**——"品牌视觉改版…" 优于 "…改版第一轮"。
 */
export function truncateName(name: string, maxChars: number): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

/**
 * 分钟粒度时长（事项窗口「今日计时」行 / 桌面今日事项面板；todos-panel.md §1）：
 *   - 0 ~ 59s → `「<1m」`（不显示 00:00，避免「看着像没计时」）
 *   - < 1h    → `「N m」`，如 `23m`
 *   - >= 1h   → `「Nh Mm」`，整点省略分：`2h` / `2h1m`
 * 默认 60 分钟。与 `formatDuration`（小条 MM:SS 秒表读数）职责分离：此处面向清单读数，
 * 且用户要求「时换 h、分换 m，尽量简洁」——不再写「小时 / 分」两个汉字。
 */
export function formatMinutes(totalSec: number): string {
  const sec = clampSeconds(totalSec);
  if (sec < SEC_PER_MIN) return '<1m';
  const totalMin = Math.round(sec / SEC_PER_MIN);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
