/**
 * Timing — 设置 · 同步 · 云端三档的纯函数（V0.11.19 批 1）
 * -----------------------------------------------------------------------------
 * 从 `mdSyncConfig.ts` 搬过来的只有一件东西：`clampMinutes` 的**行为**（越界夹边界、
 * 非数字回默认）。那一族函数随块③「同步间隔」整行删除而废掉；这里按 PRD §3.4 的
 * 口径重新落地为 5–120 分钟、默认 15，不给「同步间隔」留任何回来的入口。
 *
 * 另一个职责是块④ 状态区「四句清理文案」的**选择器**：优先级（暂停 → 有失败 →
 * 删过 → 常态）只有这一份，组件里不许再写 if 链。T03 只提供文案与选择器，
 * 状态行本身等 T04 接上 `MdSyncCloudStatus.purge` 再渲染 —— 在清理还没实现时
 * 先把「更早的会删除」挂到界面上是一句假承诺。
 */
import type { CloudSchedule, MdCloudPurgeStatus, MdSyncCloudAuto } from '../../types/domain';
import { PURGE_COPY } from './mdSyncCopy';

/** 与后端 `MD_CLOUD_INTERVAL_{MIN,MAX,DEFAULT}_MINUTES` 同值（设计 §8.1）。 */
export const AUTO_MIN_MINUTES = 5;
export const AUTO_MAX_MINUTES = 120;
export const AUTO_DEFAULT_MINUTES = 15;

/** 新装与老用户首次看到的默认值。**不从 `pollSecs` 反推档位**（PRD §15.2）。 */
export function defaultAuto(): MdSyncCloudAuto {
  return { schedule: 'smart', intervalMinutes: AUTO_DEFAULT_MINUTES };
}

/**
 * 把「可能来自老后端 / 老 mock / 手改 JSON」的值收敛成一份可用的三档配置。
 *
 * 纯读、不写回：组件在渲染时调它，只有用户真的动过控件才 `patch` 落草稿，
 * 否则「打开设置页什么都没改 → 保存」会凭空多出一个 `auto` 键，撞 QA 的逐字节比对。
 */
export function autoOf(value: MdSyncCloudAuto | undefined | null): MdSyncCloudAuto {
  if (!value) return defaultAuto();
  const schedule: CloudSchedule =
    value.schedule === 'off' || value.schedule === 'interval' || value.schedule === 'smart'
      ? value.schedule
      : 'smart';
  const raw = Number.isFinite(value.intervalMinutes)
    ? Math.trunc(value.intervalMinutes)
    : Number.NaN;
  return { schedule, intervalMinutes: clampAutoMinutes(String(raw)) };
}

/**
 * 数字框归一：越界夹边界、非数字回默认（PRD D2 的 `1 → 5` / `999 → 120`）。
 * 用 `parseInt` 而不是 `Number`：输入框里 `''` / `'abc'` 都要稳稳回到 15。
 */
export function clampAutoMinutes(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return AUTO_DEFAULT_MINUTES;
  return Math.min(AUTO_MAX_MINUTES, Math.max(AUTO_MIN_MINUTES, parsed));
}

/** 切档回调只改 `schedule`，分钟数原样带过（PRD §15.2.1 H-2）。 */
export function withSchedule(auto: MdSyncCloudAuto, schedule: CloudSchedule): MdSyncCloudAuto {
  return { ...auto, schedule };
}

/** 四句清理文案的**唯一**选择器。`n = 0` 一律落到常态句，不显示「删了 0 份」。 */
export function purgeNoteOf(status: MdCloudPurgeStatus | undefined | null): string {
  if (!status) return PURGE_COPY.idle;
  const withCount = (template: string, count: number): string =>
    template.replace('{n}', String(count));
  if (status.paused) return withCount(PURGE_COPY.paused, status.failed);
  if (status.failed > 0) return withCount(PURGE_COPY.failed, status.failed);
  if (status.deleted > 0) return withCount(PURGE_COPY.deleted, status.deleted);
  return PURGE_COPY.idle;
}
