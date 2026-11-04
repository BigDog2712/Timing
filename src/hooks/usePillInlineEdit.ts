/**
 * 提交 PillBar 的内联事项命名：创建后立即开始，或更新现有事项名称。
 * 在提交时读取权威 store 状态，避免运行中竞态生成孤立新事项。
 */
import { useCallback } from 'react';
import { useTimerActions } from './useTimerActions';
import { countdownActions } from '../services/countdownActions';
import { errorText, ipc } from '../services/ipc';
import { useCountdownArmStore } from '../stores/countdownArm';
import { useItemStore } from '../stores/itemStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

export function usePillInlineEdit(): (text: string) => void {
  const actions = useTimerActions();

  return useCallback((text: string) => {
    const edit = useUiStore.getState().inlineEdit;
    if (!edit) return;

    void (async () => {
      try {
        const status = useTimerStore.getState().state.status;
        if (edit.itemId == null) {
          if (status === 'running') {
            useUiStore.getState().setNotice({
              text: '专注进行中，事项已锁定；请先暂停或结束当前计时。',
              tone: 'info',
            });
            return;
          }
          const created = await ipc.createItem({ name: text });
          await useItemStore.getState().reload();
          /* 空闲且已用滚轮/菜单设定过倒计时 → 命名后直接起倒计时（否则仍按正计时开始） */
          const armed = useCountdownArmStore.getState().armedSec;
          if (status === 'idle') {
            if (armed != null) await countdownActions.start(created.id, armed, false);
            else await actions.start(created.id);
          } else await actions.switchTo(created.id, 'end_and_start');
        } else {
          await ipc.updateItem({ id: edit.itemId, patch: { name: text } });
          await useItemStore.getState().reload();
        }
      } catch (err) {
        useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
      } finally {
        useUiStore.getState().closeInlineEdit();
        /* 新建输入框与常用框是一起弹的，落地后一起收（挑事项那条路在 CommonItems.choose 里收） */
        useUiStore.getState().closeCommonItems();
      }
    })();
  }, [actions]);
}
