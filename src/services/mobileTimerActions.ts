/**
 * Timing — 移动端计时动作（桌面 hooks 未覆盖的两条）
 * -----------------------------------------------------------------------------
 * 为什么单独一层而不是塞进 `useTimerActions`：
 *   - `useTimerActions` 是桌面药丸/事项窗共用的入口，它的每个动作都带着桌面的
 *     右键/键盘语义；把「带 mode 的换事项」和「待办直接开计」加进去，
 *     桌面侧就会多出两个零调用点的方法（AGENTS.md 的「不留死代码」）。
 *   - 这里只做「多步时序编排 + 失败提示」，数据仍全部经 `services/api.ts` 门面。
 */
import type { SwitchMode } from '../types/domain';
import { errorText, itemApi, timerApi, todoApi } from './api';
import { useItemStore } from '../stores/itemStore';
import { useTimerStore } from '../stores/timerStore';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';

function notify(err: unknown): void {
  useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
}

export const mobileTimerActions = {
  /**
   * 点一行就开始计这一条。
   * 空闲 → `start_timer`；计时中 → 按 mode 切换：
   *   - `end_and_start`（结束并新开）：后端 `timer::switch` 只接受**非运行中**会话，
   *     所以运行中必须先暂停冻结累计，换完再继续——用户看到的是「时长不断、事项变了」；
   *   - `just_switch`（仅改归属）：后端允许运行中直接改，不动秒表。
   */
  async switchTo(itemId: number, mode: SwitchMode): Promise<void> {
    const status = useTimerStore.getState().state.status;
    try {
      if (status === 'idle') {
        await timerApi.start(itemId);
      } else {
        const wasRunning = status === 'running';
        const needPause = wasRunning && mode === 'end_and_start';
        if (needPause) await timerApi.pause();
        const next = await timerApi.switchItem(itemId, mode);
        /* 换完再「继续」：新段是否在跑由后端决定（end_and_start 会新开一条 running）。
           只在后端确实留下暂停态时补 resume，避免撞 TIMER_ALREADY_RUNNING。 */
        if (wasRunning && next.status === 'paused') await timerApi.resume();
      }
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  },

  /**
   * 待办 → 计时。后端按标题匹配事项（同名复用、无则新建）并**当场软删待办**，
   * 所以这里必须重拉待办区，否则那一行会留在屏幕上骗人（PRD P0-6）。
   * 已经在计时时后端返回 TIMER_ALREADY_RUNNING，待办不会被删——与提示一致。
   */
  async startTodo(todoId: number): Promise<void> {
    try {
      await todoApi.start(todoId);
      await useTodoStore
        .getState()
        .reload()
        .catch(() => undefined);
      /* 后端可能刚为这条待办建了同名事项：选择器与汇总条要立刻能用到它 */
      await useItemStore
        .getState()
        .reload()
        .catch(() => undefined);
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
    }
  },

  /** 新建事项并立刻切（或开始）过去：一步「新事项 + 开计」是手机上的高频路径 */
  async createAndSwitch(name: string, mode: SwitchMode): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      useUiStore.getState().setNotice({ text: '事项名称不能为空', tone: 'danger' });
      return false;
    }
    try {
      const item = await itemApi.create({ name: trimmed });
      await useItemStore.getState().reload();
      await mobileTimerActions.switchTo(item.id, mode);
      return true;
    } catch (err) {
      notify(err);
      return false;
    }
  },
};
