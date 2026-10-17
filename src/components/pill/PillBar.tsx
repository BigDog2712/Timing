/**
 * TickBar — 药丸主视图 PillBar（常驻，AC-01）
 * -----------------------------------------------------------------------------
 * 交互分层（pill-bar.md §3.3 / context-menu.md §3.2，硬规范）：
 *   - 左键点环：idle→running / running→paused / paused→running（200ms 去抖）
 *   - 右键单击（按下→抬起 < 400ms）：立即结束并保存 + 撤销条（AC-05）
 *   - 右键长按（>= 500ms）：弹出上下文菜单；400–500ms 不确定区视为单击
 *   - 键盘（焦点在环上）：Space 开始/暂停；Enter 结束并保存
 *   - Menu / Shift+F10：弹出菜单；Esc：关闭菜单/面板（RUNNING 下**不**结束）
 * 视觉四态：idle / running / paused / ended（ended 为 900ms 瞬时确认，非状态机第四态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { CLICK_MAX_MS, COUNTDOWN_WARN_SEC, DEBOUNCE_MS, ENDED_FLASH_MS, LONG_PRESS_MS } from '../../lib/constants';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState, type VisualState } from '../../types/ui';
import { CollapseHandle } from './CollapseHandle';
import { ItemName } from './ItemName';
import { MainButton } from './MainButton';
import { NewItemEntry } from './NewItemEntry';
import { TimerDisplay } from './TimerDisplay';

const RING_LABEL: Record<VisualState, string> = {
  idle: '开始计时',
  running: '暂停计时',
  paused: '继续计时',
  ended: '已保存',
};

export function PillBar() {
  const actions = useTimerActions();
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const endedAt = useUiStore((s) => s.endedAt);
  const openPanel = useUiStore((s) => s.openPanel);
  const openMenu = useUiStore((s) => s.openMenu);
  const openCommonItems = useUiStore((s) => s.openCommonItems);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  const menuOpen = useUiStore((s) => s.menuOpen);
  const panel = useUiStore((s) => s.panel);
  const countdownPos = useUiStore((s) => s.countdownPos);
  const commonItemsPos = useUiStore((s) => s.commonItemsPos);
  const reminderPopover = useUiStore((s) => s.reminderPopover);

  /* 未悬停时隐去背景板；任一悬浮层（菜单 / 面板 / 倒计时 / 常用事项 / 提醒）展开期间强制显影，
     避免交互中「药丸凭空消失」 */
  const revealed =
    menuOpen ||
    panel !== 'none' ||
    countdownPos != null ||
    commonItemsPos != null ||
    reminderPopover != null;

  /* 结束态：900ms 瞬时视觉确认（--dur-confirm） */
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (endedAt == null) return;
    setEnded(true);
    const id = window.setTimeout(() => setEnded(false), ENDED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [endedAt]);

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const currentName = findItem(items, currentItemId)?.name;

  /* [V0.2.0] 倒计时：小条显示**剩余**（targetSec - accumulatedSec 派生），到点前 warn 提示 */
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const displaySec = isCountdown ? remaining : seconds;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  /* 左键：连点去抖 */
  const lastClickRef = useRef(0);
  const onRingClick = useCallback(() => {
    const t = Date.now();
    if (t - lastClickRef.current < DEBOUNCE_MS) return;
    lastClickRef.current = t;
    void actions.togglePause();
  }, [actions]);

  /* 右键：单击结束 / 长按菜单 */
  const pressStartRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const menuShownRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 2) return;
    menuShownRef.current = false;
    pressStartRef.current = Date.now();
    const { clientX, clientY } = e;
    longPressTimerRef.current = window.setTimeout(() => {
      menuShownRef.current = true;
      openMenu({ x: clientX, y: clientY });
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = (e: ReactPointerEvent) => {
    if (e.button !== 2) return;
    clearLongPress();
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (menuShownRef.current) return;
    // 无 active 会话时右键单击 → 弹菜单（语境自适应）
    if (status === 'idle') {
      openMenu({ x: e.clientX, y: e.clientY });
      return;
    }
    if (start != null && Date.now() - start < CLICK_MAX_MS) void actions.stop();
  };

  const handleContextMenu = (e: ReactMouseEvent) => e.preventDefault();

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const onRing = target.classList.contains('ring');
    if ((e.key === ' ' || e.key === 'Spacebar') && onRing) {
      e.preventDefault();
      if (!e.repeat) void actions.togglePause();
      return;
    }
    if (e.key === 'Enter' && onRing) {
      e.preventDefault();
      if (!e.repeat && status !== 'idle') void actions.stop();
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openMenu({ x: 12, y: 56 });
      return;
    }
    if (e.key === 'Escape') {
      useUiStore.getState().closeMenu();
      useUiStore.getState().closePanel();
    }
  };

  return (
    <div
      className="pill"
      data-state={visual}
      data-reveal={revealed ? 'true' : undefined}
      data-tauri-drag-region
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearLongPress}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      <MainButton
        state={visual}
        label={isCountdown ? `${RING_LABEL[visual]}（倒计时）` : RING_LABEL[visual]}
        onClick={onRingClick}
        countdown={isCountdown}
        progress={isCountdown && session?.targetSec ? remaining / session.targetSec : 1}
        warn={nearEnd}
      />
      <TimerDisplay
        seconds={displaySec}
        mode={isCountdown ? 'countdown' : 'countup'}
        tone={nearEnd ? 'warn' : 'default'}
      />
      {status === 'idle' ? (
        <NewItemEntry onClick={() => openPanel('create')} />
      ) : (
        <ItemName
          name={currentName ?? '未归类'}
          muted={visual === 'ended'}
          onClick={() => openCommonItems({ x: 12, y: 56 })}
        />
      )}
      <CollapseHandle collapsed={false} onToggle={toggleCollapsed} />
    </div>
  );
}
