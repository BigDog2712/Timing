/**
 * TickBar — 上下文菜单 ContextMenu（context-menu.md · V0.2.0 自绘玻璃改造）
 * -----------------------------------------------------------------------------
 * 触发：小条右键长按 >= 500ms / Menu 键 / Shift+F10（单击 <400ms 走 stop_timer，不进菜单）。
 * 结构：状态块（计时中/暂停时）+ 分组项 + 1px 分隔线；「事项窗口」为 V0.2.0 新增入口（C4）。
 * 键盘：↑↓ / Home / End 移动、Enter 执行、Esc 关闭、Tab 移出（见 GlassMenu）。
 * 反模式：禁止 3px 彩色左边框；分组用 1px --line 分隔线；玻璃为板式拟玻璃（94% 板）。
 */
import { useMemo } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { formatClockTime, formatDuration } from '../../lib/format';
import {
  CalendarClockIcon,
  CheckIcon,
  ListIcon,
  PauseIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  SettingsIcon,
  StickyNoteIcon,
  TimerIcon,
  TrashIcon,
} from '../../lib/icons';
import { openSettings, settingsActions } from '../../services/settingsActions';
import { openNoteForItem } from '../../services/noteActions';
import { openTodosWindow } from '../../services/todosActions';
import { reminderActions } from '../../services/reminderActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry, type MenuStatus } from './GlassMenu';

export function ContextMenu() {
  const actions = useTimerActions();
  const liveSec = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const items = useItemStore((s) => s.items);
  const alwaysOnTop = useSettingsStore((s) => s.settings.alwaysOnTop);
  const menuPos = useUiStore((s) => s.menuPos);
  const closeMenu = useUiStore((s) => s.closeMenu);
  const openPanel = useUiStore((s) => s.openPanel);

  const idle = status === 'idle';
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const activeItemId = session?.itemId ?? lastItemId ?? items[0]?.id ?? null;
  const activeItemName = findItem(items, activeItemId)?.name ?? '未归类';

  const entries = useMemo<MenuEntry[]>(
    () => [
      {
        type: 'item',
        id: 'toggle',
        label: idle ? '开始计时' : status === 'running' ? '暂停' : '继续',
        icon: idle || status === 'paused' ? PlayIcon : PauseIcon,
        accel: 'SPACE',
        onSelect: () => void actions.togglePause(),
      },
      {
        type: 'item',
        id: 'stop',
        label: '结束并保存',
        icon: CheckIcon,
        accel: 'ENTER',
        disabled: idle,
        onSelect: () => void actions.stop(),
      },
      {
        type: 'item',
        id: 'countdown',
        label: '倒计时…',
        icon: TimerIcon,
        onSelect: () => useUiStore.getState().openCountdownMenu({ pos: menuPos, itemId: activeItemId }),
      },
      {
        type: 'item',
        id: 'reminder',
        label: '提醒…',
        icon: CalendarClockIcon,
        onSelect: () =>
          activeItemId != null && reminderActions.openSet('item', activeItemId, activeItemName, menuPos),
      },
      {
        type: 'item',
        id: 'common',
        label: '常用事项…',
        icon: ListIcon,
        onSelect: () => useUiStore.getState().openCommonItems(menuPos),
      },
      {
        /* AC-38：小条右键「便利贴…」绑定**当前计时事项**（计时中=session.itemId；空闲=当前选中事项） */
        type: 'item',
        id: 'note',
        label: '便利贴…',
        icon: StickyNoteIcon,
        disabled: activeItemId == null,
        onSelect: () => activeItemId != null && void openNoteForItem(activeItemId),
      },
      {
        type: 'item',
        id: 'edit',
        label: '微调开始时间',
        icon: PencilIcon,
        onSelect: () => openPanel('records'),
      },
      {
        type: 'item',
        id: 'discard',
        label: '丢弃本次记录',
        icon: TrashIcon,
        danger: true,
        disabled: idle,
        onSelect: () => void actions.discardCurrent(),
      },
      { type: 'separator', id: 'sep-todos' },
      /* [V0.2.0] 事项窗口入口（C4；独立 336 窗） */
      { type: 'item', id: 'todos', label: '事项窗口', icon: ListIcon, onSelect: () => void openTodosWindow() },
      {
        type: 'item',
        id: 'pin',
        label: '保持置顶',
        icon: alwaysOnTop ? PinIcon : PinOffIcon,
        checked: alwaysOnTop,
        onSelect: () => void settingsActions.setAlwaysOnTop(!alwaysOnTop),
      },
      { type: 'separator', id: 'sep-settings' },
      { type: 'item', id: 'settings', label: '设置…', icon: SettingsIcon, onSelect: () => void openSettings() },
    ],
    [idle, status, alwaysOnTop, actions, openPanel, menuPos, activeItemId, activeItemName],
  );

  /* 状态块：计时中 / 暂停时显示（空闲不显示） */
  const statusBlock = useMemo<MenuStatus | null>(() => {
    if (!session) return null;
    const name = findItem(items, session.itemId)?.name ?? '未归类';
    const isCountdown = session.mode === 'countdown' && session.targetSec != null;
    const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - liveSec) : 0;
    const detail = isCountdown
      ? `倒计时 · 剩 ${formatDuration(remaining)}`
      : `${status === 'paused' ? '已暂停' : '计时中'} · ${formatDuration(liveSec)}`;
    return { title: name, meta: formatClockTime(session.startedAt), detail, tone: 'accent' };
  }, [session, items, liveSec, status]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={closeMenu} aria-hidden />
      <GlassMenu
        entries={entries}
        status={statusBlock}
        anchor={menuPos}
        ariaLabel="计时操作"
        onClose={closeMenu}
      />
    </>
  );
}
