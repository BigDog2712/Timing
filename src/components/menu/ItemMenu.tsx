/**
 * TickBar — 事项菜单 ItemMenu（[V0.2.3 · 4]）
 * -----------------------------------------------------------------------------
 * 触发：右键小条上的事项名（ItemName.onMenu → uiStore.openItemMenu）。
 * 结构对齐 Timing v1.7.3 的「事项行菜单」（MainForm.TodoRowMenuRows）：
 *   开始/停止计时 · {事项} ／ 编辑事项 ／ 开·关提醒 · {事项}
 *   —— 分隔 ——
 *   新建便利贴 ／ 便利贴清单
 *   —— 分隔 ——
 *   删除事项（两步确认，走软删除 delete_item，历史记录不受影响）
 * 与小条本体的右键菜单（ContextMenu = 计时操作 + 全局入口）分工：本菜单只作用于**这一条事项**。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import {
  CalendarClockIcon,
  CheckIcon,
  ListIcon,
  PencilIcon,
  PlayIcon,
  StickyNoteIcon,
  TrashIcon,
} from '../../lib/icons';
import { errorText, ipc } from '../../services/ipc';
import { openNewNote } from '../../services/noteActions';
import { reminderActions } from '../../services/reminderActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry } from './GlassMenu';

/** 删除事项的两步确认窗口（与便利贴圆点同口径） */
const ARM_MS = 3500;

export function ItemMenu() {
  const actions = useTimerActions();
  const itemMenu = useUiStore((s) => s.itemMenu);
  const closeItemMenu = useUiStore((s) => s.closeItemMenu);
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);

  const item = findItem(items, itemMenu?.itemId ?? null);
  const name = item?.name ?? '未归类';
  const [armed, setArmed] = useState(false);
  const [hasReminder, setHasReminder] = useState(false);

  /* 提醒状态：菜单弹出时问一次后端（reminder_pending），用于「开提醒 / 关提醒」二选一 */
  useEffect(() => {
    const id = item?.id;
    if (id == null) return;
    let alive = true;
    void ipc
      .reminderPending()
      .then((list) => {
        if (alive) setHasReminder(list.some((r) => r.target === 'item' && r.targetId === id));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item?.id]);

  const pos = itemMenu?.pos ?? { x: 12, y: 56 };
  const runningThis = status !== 'idle' && sessionItemId != null && sessionItemId === item?.id;

  const removeItem = useCallback(() => {
    const target = item;
    if (!target) return;
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => {
        useUiStore.getState().closeItemMenu();
      }, ARM_MS);
      return;
    }
    void (async () => {
      try {
        await ipc.deleteItem({ id: target.id });
        await useItemStore.getState().reload();
        closeItemMenu();
      } catch (err) {
        useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
      }
    })();
  }, [armed, item, closeItemMenu]);

  const entries = useMemo<MenuEntry[]>(() => {
    if (!itemMenu || !item) {
      return [{ type: 'item', id: 'none', label: '没有可操作的事项', icon: ListIcon, disabled: true, onSelect: () => undefined }];
    }
    const id = item.id;
    const startRow: MenuEntry = runningThis
      ? { type: 'item', id: 'stop', label: `停止计时 · ${name}`, icon: CheckIcon, onSelect: () => void actions.stop() }
      : {
          type: 'item',
          id: 'start',
          label: `开始计时 · ${name}`,
          icon: PlayIcon,
          disabled: item.isSystem,
          onSelect: () =>
            void (status === 'idle' ? actions.start(id) : actions.switchTo(id, 'end_and_start')),
        };

    return [
      startRow,
      {
        type: 'item',
        id: 'rename',
        label: '编辑事项',
        icon: PencilIcon,
        onSelect: () => useUiStore.getState().openInlineEdit({ itemId: id, initial: name }),
      },
      {
        type: 'item',
        id: 'reminder',
        label: hasReminder ? `关提醒 · ${name}` : `开提醒 · ${name}`,
        icon: CalendarClockIcon,
        onSelect: () => {
          if (hasReminder) {
            void reminderActions.clear('item', id);
            setHasReminder(false);
            closeItemMenu();
            return;
          }
          reminderActions.openSet('item', id, name, pos);
        },
      },
      { type: 'separator', id: 'sep-notes' },
      {
        type: 'item',
        id: 'note-new',
        label: '新建便利贴',
        icon: StickyNoteIcon,
        onSelect: () => void openNewNote(id),
      },
      {
        type: 'item',
        id: 'note-list',
        label: '便利贴清单',
        icon: ListIcon,
        onSelect: () => useUiStore.getState().openNotesList(pos),
      },
      { type: 'separator', id: 'sep-delete' },
      {
        type: 'item',
        id: 'delete',
        label: armed ? `再点一次删除「${name}」` : '删除事项',
        icon: TrashIcon,
        danger: true,
        disabled: item.isSystem,
        onSelect: removeItem,
      },
    ];
  }, [itemMenu, item, name, runningThis, hasReminder, armed, actions, pos, closeItemMenu, removeItem]);

  if (!itemMenu) return null;

  return (
    <>
      <div className="menu-scrim" onMouseDown={closeItemMenu} aria-hidden />
      <GlassMenu entries={entries} anchor={pos} ariaLabel="事项操作" onClose={closeItemMenu} />
    </>
  );
}
