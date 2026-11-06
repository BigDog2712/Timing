/**
 * Timing — 设置 · 同步 · 配置小口径（V0.11.13）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` / `useMdSyncDraft` 里抽出来的**唯一一份**数字与字符串口径：间隔上下限、
 * 分钟↔秒换算、云端通道空配置。
 *
 * 为什么不各写一份：保存按一处算、「测试连接」按另一处算，很快就出现「测试通过、保存后
 * 不生效」这类没人能复现的故障。本文件是纯函数，不读 state、不碰网络。
 */
import type { MdSyncCloud } from '../../types/domain';

/** 间隔上下限（分钟）：与后端 `MD_SYNC_POLL_MIN_SECS / MAX_SECS` 同值 */
export const POLL_MIN_MINUTES = 1;
export const POLL_MAX_MINUTES = 1440;
export const POLL_DEFAULT_MINUTES = 15;

/** 秒 → 分钟（配置存秒，界面按分钟说人话） */
export function toMinutes(secs: number): number {
  return Math.max(POLL_MIN_MINUTES, Math.round(secs / 60));
}

/** 分钟输入归一：越界夹到边界，非数字回默认（不让用户卡在一个非法值上） */
export function clampMinutes(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return POLL_DEFAULT_MINUTES;
  return Math.min(POLL_MAX_MINUTES, Math.max(POLL_MIN_MINUTES, parsed));
}

/** 分钟文本 → 落库口径（秒）：保存与「测试连接」共用这一处 */
export function pollSecsOf(raw: string): number {
  return clampMinutes(raw) * 60;
}

/** 间隔文案：整点补一句「（2 小时）」，用户不必自己心算 */
export function describeInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${minutes} 分钟（${hours} 小时）` : `${minutes} 分钟`;
}

/* 云端通道空配置：`enabled` 必须是 `false`——视图没加载时凭空给 `true`，用户下一次
   保存就会把云端通道偷偷打开。`basePath` 的 `/Timing/md` 是 ADR-061 定的默认远端目录。 */
export function emptyCloud(): MdSyncCloud {
  return {
    enabled: false,
    mode: 'localfolder',
    localRoot: '',
    baseUrl: '',
    basePath: '/Timing/md',
    user: '',
  };
}
