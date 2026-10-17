/**
 * TickBar — 倒计时动作（批2 N-6；菜单共用；唯一启动倒计时口径）
 * -----------------------------------------------------------------------------
 * 语义（countdown-menu.md §3.3）：
 *   - idle → 直接 start_countdown。
 *   - 计时中 / 倒计时中 → 「结束当前并开始」：先 stop_timer（**落盘保存**当前段）再 start_countdown。
 *   - 失败（INVALID_TARGET_SEC / TIMER_ALREADY_RUNNING）→ 提示条，不崩溃。
 * 到点判定归 Rust（1s watcher）；前端只订阅 countdown-finished 做视觉（useAppBootstrap）。
 */
import { errorText, ipc } from './ipc';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

export const countdownActions = {
  /**
   * 启动倒计时。
   * @param targetItemId 归属事项（省略 = 后端取 lastItemId / 未归类）
   * @param targetSec 目标秒数
   * @param replace 是否「结束当前并开始」（计时中 / 倒计时中为 true）
   */
  async start(targetItemId: number | undefined, targetSec: number, replace: boolean): Promise<void> {
    try {
      if (replace) await ipc.stopTimer();
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
