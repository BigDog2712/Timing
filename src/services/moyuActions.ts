/**
 * TickBar — 摸鱼菜单动作（V0.3.2 / V0.3.9 支持正计时）
 * -----------------------------------------------------------------------------
 * 语义：**按「事项名 + 模式（+ 倒计时分钟）」一键开始**，不需要先建事项。
 *
 *   1. 事项名按 trim 后精确匹配现有事项；找不到就新建一条（同名允许，见 ADR-021）。
 *   2. 已有会话时走「结束当前并开始」——结束的那段照常落盘；低于「最短记录时长」
 *      的按 ADR-023 丢弃并提示。**两种情况都不开撤销条**：新会话已经开跑，
 *      撤销必然撞 `TIMER_ALREADY_RUNNING`（见 `countdownActions` 头注释）。
 *   3. 正计时条目（`mode = countup`）忽略分钟数，直接 `start_timer`。
 *   4. 任何失败都经提示条出口，不弹对话框、不崩界面。
 */
import { itemApi } from './api';
import { errorText, ipc } from './ipc';
import { clampMoyuMinutes } from '../lib/moyu';
import { useItemStore } from '../stores/itemStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import type { TimerMode } from '../types/domain';

/** 「最短记录时长」兜底：与后端 `ReferenceSettings::default().min_record_seconds` 同值 */
const FALLBACK_MIN_RECORD_SEC = 30;

/** 按名称取事项 id；没有就建一条。空名 → undefined（后端归到「未归类」）。 */
async function ensureItemId(name: string): Promise<number | undefined> {
  const target = name.trim();
  if (target.length === 0) return undefined;

  const cached = useItemStore.getState().items.find((item) => item.name.trim() === target);
  if (cached) return cached.id;

  const created = await itemApi.create({ name: target });
  /* 新建后刷新列表：小条事项名、便利贴手柄都依赖 itemStore，不刷新会显示「未归类」。 */
  await useItemStore.getState().reload().catch(() => undefined);
  return created.id;
}

/** 结束当前会话（替换语义）；低于阈值时补一条「未记录」提示。 */
async function stopForReplace(): Promise<void> {
  const stopped = await ipc.stopTimer();
  if (!stopped.discarded) return;
  const threshold =
    useSettingsStore.getState().referenceSettings?.minRecordSeconds ?? FALLBACK_MIN_RECORD_SEC;
  useUiStore.getState().setNotice({ text: `不足 ${threshold} 秒，未记录`, tone: 'info' });
}

export const moyuActions = {
  /**
   * @param name    事项名（空串 = 归到「未归类」）
   * @param minutes 目标时长（分钟，1..=1440；正计时条目忽略）
   * @param mode    正计时 / 倒计时
   * @param replace true = 先结束当前会话（暂停/计时中唤出菜单时为 true）
   */
  async start(name: string, mode: TimerMode, minutes: number, replace: boolean): Promise<void> {
    try {
      const itemId = await ensureItemId(name);
      if (replace) await stopForReplace();
      if (mode === 'countdown') {
        await ipc.startCountdown({ itemId, targetSec: clampMoyuMinutes(minutes) * 60 });
      } else {
        await ipc.startTimer({ itemId });
      }
      await useTimerStore.getState().refresh();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  },
};
