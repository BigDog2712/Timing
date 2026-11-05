/**
 * Timing — 暂停 ⇄ 摸鱼菜单的连招（V0.3.8）
 * -----------------------------------------------------------------------------
 * 用户口径：「暂停瞬间摸鱼菜单未弹出……修改成自动弹出」。
 * V0.3.1 删常用事项菜单时把「暂停 + 摊开菜单」连招一并砍了；V0.3.2 摸鱼菜单接棒后
 * 只给了手动入口（暂停后右键数字 / 点事项名），暂停本身裸翻状态——想换件事还得再点一下。
 *
 * 行为约定（双向，真实渲染验证过 T0–T3）：
 * - **暂停方向**（running → paused）：收口后自动弹出摸鱼菜单；
 * - **继续方向**（paused → running）：收掉摸鱼菜单——菜单是暂停态的配件，
 *   环已恢复行进还挂着「换件事」的菜单属于状态错位（首轮 CDP 实测抓到后补上）；
 * - 等 `togglePause` 收口后以 store 真值为准：IPC 失败会被 refresh 回真值，
 *   不弹不收（不会出现「状态还在跑、菜单却开了」的错位）；
 * - 锚点与手动入口同源：小条下沿 +4px、x 固定 32（对齐 PillBar 的 posBelowBar 口径）；
 * - 圆环左键 / 数字左键（Zone.Time 委托圆环）/ Space 三条路径共用这一个回调。
 */
import { useCallback, type RefObject } from 'react';
import { clientToLayer } from '../lib/fitBounds';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import type { TimerActions } from './useTimerActions';

export function usePauseMoyu(
  actions: Pick<TimerActions, 'togglePause'>,
  pillRef: RefObject<HTMLDivElement | null>,
  currentItemId: number | null | undefined,
): () => void {
  const openMoyuMenu = useUiStore((s) => s.openMoyuMenu);
  const closeMoyuMenu = useUiStore((s) => s.closeMoyuMenu);
  return useCallback(() => {
    /* 调用瞬间取真值决定方向：渲染帧与点击帧之间的状态漂移不该改变连招方向 */
    const before = useTimerStore.getState().state.status;
    void actions.togglePause().then(() => {
      const after = useTimerStore.getState().state.status;
      if (before === 'running' && after === 'paused') {
        const rect = pillRef.current?.getBoundingClientRect();
        const pos = rect ? { x: 32, y: clientToLayer(0, rect.bottom).y + 4 } : { x: 32, y: 56 };
        openMoyuMenu({ pos, itemId: currentItemId });
        return;
      }
      /* 继续方向：菜单跟着暂停态一起走。先判 before 是 paused 再收，
         避免 idle → running（开始计时）路径误伤其他浮层 */
      if (before === 'paused' && after === 'running') closeMoyuMenu();
    });
  }, [actions, pillRef, currentItemId, openMoyuMenu, closeMoyuMenu]);
}
