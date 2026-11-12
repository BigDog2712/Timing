/**
 * Timing — 倒计时动作（批2 N-6；菜单共用；唯一启动倒计时口径）
 * -----------------------------------------------------------------------------
 * 语义（countdown-menu.md §3.3）：
 *   - idle → 直接 start_countdown。
 *   - 计时中 / 倒计时中 → 「结束当前并开始」：先 stop_timer 再 start_countdown。
 *   - 失败（INVALID_TARGET_SEC / TIMER_ALREADY_RUNNING）→ 提示条，不崩溃。
 * 到点判定归 Rust（1s watcher）；前端只订阅 countdown-finished 做视觉（useAppBootstrap）。
 *
 * [V0.3.4] 被替换掉的那一段受「最短记录时长」约束（后端 `timer::stop`）：
 *   低于阈值 → 直接丢弃，这里只补一条「不足 N 秒，未记录」的提示；
 *   否则照常落盘。**两种情况都不开撤销条**——紧接着就开了新会话，
 *   `undo_stop` 必然撞 `TIMER_ALREADY_RUNNING`，弹一条撤不掉的条比不弹更糟。
 */
import { errorText, ipc } from './ipc';
import { useSettingsStore } from '../stores/settingsStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

/** 「最短记录时长」兜底：与后端 `ReferenceSettings::default().min_record_seconds` 同值 */
const FALLBACK_MIN_RECORD_SEC = 30;

export const countdownActions = {
  /**
   * 启动倒计时。
   * @param targetItemId 归属事项（省略 = 后端取 lastItemId / 未归类）
   * @param targetSec 目标秒数
   * @param replace 是否「结束当前并开始」（计时中 / 倒计时中为 true）
   */
  async start(targetItemId: number | undefined, targetSec: number, replace: boolean): Promise<void> {
    try {
      if (replace) {
        const stopped = await ipc.stopTimer();
        if (stopped.discarded) {
          const threshold =
            useSettingsStore.getState().referenceSettings?.minRecordSeconds ?? FALLBACK_MIN_RECORD_SEC;
          useUiStore.getState().setNotice({ text: `不足 ${threshold} 秒，未记录`, tone: 'info' });
        }
      }
      await ipc.startCountdown({ itemId: targetItemId, targetSec });
      await useTimerStore.getState().refresh();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  },

  /** 写入倒计时预设（去重 + 升序；设置面板 / 菜单共用口径） */
  async setPresets(presets: number[]): Promise<number[]> {
    const saved = await ipc.setCountdownPreset({ presets });
    return saved;
  },
};
