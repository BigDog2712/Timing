/**
 * TickBar — 药丸主视图 PillBar（常驻，AC-01）
 * -----------------------------------------------------------------------------
 * 区域操作以 Timing v1.7.3 MainForm.OnMouseUp 为准；拖动由 usePillDrag 隔离。
 * 键盘：Space 开始/暂停，Enter 结束；Menu / Shift+F10 菜单，Esc 收起。
 * 视觉四态：idle / running / paused / ended（ended 为 900ms 瞬时确认，非状态机第四态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { COUNTDOWN_WARN_SEC, DEBOUNCE_MS, ENDED_FLASH_MS } from '../../lib/constants';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { usePillDrag } from '../../hooks/usePillDrag';
import { usePillInlineEdit } from '../../hooks/usePillInlineEdit';
import { countdownActions } from '../../services/countdownActions';
import { openOrCreateNoteForItem } from '../../services/noteActions';
import { readCountdownDuration, useCountdownArmStore } from '../../stores/countdownArm';
import { useSettingsStore } from '../../stores/settingsStore';
import { openTodosWindow } from '../../services/todosActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import { toVisualState, type VisualState } from '../../types/ui';
import { ItemName } from './ItemName';
import { InlineNameEntry } from './InlineNameEntry';
import { MainButton } from './MainButton';
import { NewItemEntry } from './NewItemEntry';
import { NoteHandle } from './NoteHandle';
import { TimerDisplay } from './TimerDisplay';

const RING_LABEL: Record<VisualState, string> = {
  idle: '开始计时',
  running: '暂停计时',
  paused: '继续计时',
  ended: '已保存',
};

export function PillBar() {
  const actions = useTimerActions();
  const submitInline = usePillInlineEdit();
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  /* [V0.2.5 · 5] 已设定的倒计时时长：idle 时小条直接显示它（参照 Timing v1.7.3 的 TimeText） */
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  const arm = useCountdownArmStore((s) => s.arm);
  const clearArm = useCountdownArmStore((s) => s.clear);
  const presets = useSettingsStore((s) => s.settings.countdownPresets);
  const openCommonItems = useUiStore((s) => s.openCommonItems);
  const items = useItemStore((s) => s.items);
  const endedAt = useUiStore((s) => s.endedAt);
  const openMenu = useUiStore((s) => s.openMenu);
  const openNotesList = useUiStore((s) => s.openNotesList);
  const menuOpen = useUiStore((s) => s.menuOpen);
  const panel = useUiStore((s) => s.panel);
  const countdownPos = useUiStore((s) => s.countdownPos);
  const countdownCardPos = useUiStore((s) => s.countdownCardPos);
  const commonItemsPos = useUiStore((s) => s.commonItemsPos);
  const reminderPopover = useUiStore((s) => s.reminderPopover);
  const notesListPos = useUiStore((s) => s.notesListPos);
  const itemMenu = useUiStore((s) => s.itemMenu);
  const inlineEdit = useUiStore((s) => s.inlineEdit);
  const openInlineEdit = useUiStore((s) => s.openInlineEdit);
  const openCountdownMenu = useUiStore((s) => s.openCountdownMenu);

  /* 未悬停时隐去背景板；任一悬浮层（菜单 / 面板 / 倒计时 / 常用事项 / 提醒 / 便利贴清单 / 事项菜单）展开期间强制显影，
     避免交互中「药丸凭空消失」 */
  const revealed =
    menuOpen ||
    panel !== 'none' ||
    countdownPos != null ||
    countdownCardPos != null ||
    commonItemsPos != null ||
    reminderPopover != null ||
    notesListPos != null ||
    inlineEdit != null ||
    itemMenu != null;

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

  /* 左键点「新建事项」/ 点事项名 = 就地长出输入框（不再弹 ItemPicker 面板） */
  const beginCreate = useCallback(() => {
    if (status === 'running') {
      useUiStore.getState().setNotice({ text: '专注进行中，事项已锁定；请先暂停或结束当前计时。', tone: 'info' });
      return;
    }
    openInlineEdit({ itemId: null, initial: '' });
  }, [openInlineEdit, status]);

  /* 倒计时菜单整块 233px 高，用光标位置当锚点会盖住小条本身：统一贴到小条下沿 +4px 展开 */
  const pillRef = useRef<HTMLDivElement>(null);
  const posBelowBar = useCallback((pos: MenuPos): MenuPos => {
    const rect = pillRef.current?.getBoundingClientRect();
    return rect ? { x: pos.x, y: rect.bottom + 4 } : pos;
  }, []);

  /* [V0.2.0] 倒计时：小条显示**剩余**（targetSec - accumulatedSec 派生），到点前 warn 提示
     [V0.2.5 · 5] 空闲但已设定档位时，小条直接显示该时长（等用户点圆环才开始倒数） */
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const armedIdle = status === 'idle' && armedSec != null;
  const displaySec = isCountdown ? remaining : armedIdle ? (armedSec ?? 0) : seconds;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  /* 左键：连点去抖；空闲且已设定倒计时档位时，左键 = 开始倒计时（参照 v1.7.3 的点开始）
     [V0.2.6] 计时中点击圆环 → 先暂停，再摊开常用事项菜单（对齐 OnRingLeft 的 Pause + ShowCommonMenu） */
  const lastClickRef = useRef(0);
  const onRingClick = useCallback(() => {
    const t = Date.now();
    if (t - lastClickRef.current < DEBOUNCE_MS) return;
    lastClickRef.current = t;
    useUiStore.getState().closeCountdownCard();
    if (status === 'idle' && currentItemId == null) {
      beginCreate();
      return;
    }
    if (status === 'idle' && armedSec != null) {
      void countdownActions.start(currentItemId ?? undefined, armedSec, false);
      return;
    }
    if (status === 'running') {
      void actions.togglePause().then(() => {
        openCommonItems({ x: 12, y: 56 });
      });
      return;
    }
    void actions.togglePause();
  }, [actions, armedSec, currentItemId, status, openCommonItems, beginCreate]);

  /* [V0.2.6] Zone.Time 左键：计时中/暂停 = 与圆环相同；空闲 = 正计时 ⇄ 倒计时切换
     （对齐 ToggleCountdownMode：切到倒计时用设置里的第一档，再点回正计时） */
  const onTimeClick = useCallback(() => {
    if (status !== 'idle') {
      onRingClick();
      return;
    }
    if (armedSec != null) {
      clearArm();
      useUiStore.getState().setNotice({ text: '正计时', tone: 'info' });
      return;
    }
    const duration = readCountdownDuration(presets[0] ?? 1500);
    arm(duration);
    useUiStore.getState().openCountdownCard(posBelowBar({ x: 32, y: 56 }));
  }, [status, onRingClick, armedSec, clearArm, arm, presets, openCountdownMenu, posBelowBar, currentItemId]);

  const drag = usePillDrag();
  const handlePointerUp = (e: ReactPointerEvent) => {
    if (e.button === 2) openMenu({ x: e.clientX, y: e.clientY });
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
      ref={pillRef}
      className="pill"
      data-state={visual}
      data-reveal={revealed ? 'true' : undefined}
      onPointerDown={(e) => {
        drag.onDown(e);
      }}
      onPointerMove={drag.onMove}
      onPointerUp={(e) => {
        drag.onUp();
        handlePointerUp(e);
      }}
      onPointerCancel={drag.onUp}
      onClickCapture={drag.onClickCapture}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      <MainButton
        state={visual}
        label={
          armedIdle
            ? '开始倒计时（右键改档位）'
            : isCountdown
              ? `${RING_LABEL[visual]}（倒计时）`
              : RING_LABEL[visual]
        }
        onClick={onRingClick}
        countdown={isCountdown || armedIdle}
        progress={isCountdown && session?.targetSec ? remaining / session.targetSec : 1}
        warn={nearEnd}
        /* [V0.2.6] Zone.Ring 右键：计时中 = 结束并保存；空闲 = 主菜单（对齐 Timing OnRingRight） */
        onMenu={(pos) => {
          if (status === 'idle') openMenu(pos);
          else void actions.stop();
        }}
      />
      <TimerDisplay
        seconds={displaySec}
        mode={isCountdown || armedIdle ? 'countdown' : 'countup'}
        tone={nearEnd ? 'warn' : 'default'}
        /* [V0.2.6] Zone.Time 左键：计时中 = 与圆环相同（暂停/继续）；空闲 = 正计时 ⇄ 倒计时切换 */
        onActivate={onTimeClick}
        /* [V0.2.6] Zone.Time 右键：计时中 = 主菜单；空闲且已设定 = 倒计时菜单；空闲 = 主菜单 */
        onMenu={(pos) => {
          if (status === 'idle' && armedSec != null) {
            openCountdownMenu({ pos: posBelowBar(pos), itemId: currentItemId, custom: true });
            return;
          }
          openMenu(pos);
        }}
      />
      {inlineEdit ? (
        <InlineNameEntry
          key={inlineEdit.itemId ?? 'new'}
          initial={inlineEdit.initial}
          placeholder={inlineEdit.itemId == null ? '新事项名称' : '事项名称'}
          onSubmit={submitInline}
          onCancel={() => useUiStore.getState().closeInlineEdit()}
        />
      ) : status === 'idle' ? (
        <NewItemEntry
          onClick={beginCreate}
          /* [V0.2.6] Zone.Task 右键：展开事项窗口（对齐 Timing 的「今日计时」面板；事项级菜单在窗内逐行给） */
          onMenu={() => void openTodosWindow()}
        />
      ) : (
        <ItemName
          name={currentName ?? '未归类'}
          muted={visual === 'ended'}
          /* [V0.2.6] Zone.Task：左键暂停态 = 常用事项菜单（对齐 Timing ShowCommonMenu），
             其余状态 = 快捷新建（就地命名后立即开始）；右键 = 展开事项窗口 */
          onActivate={() => {
            if (status === 'paused') {
              openCommonItems({ x: 12, y: 56 });
              return;
            }
            beginCreate();
          }}
          onMenu={() => void openTodosWindow()}
        />
      )}
      {/* [V0.2.1 · 1.5] 手柄改绑便利贴：左键开当前事项便利贴，右键开便利贴清单 */}
      <NoteHandle
        itemId={currentItemId}
        onOpenNote={() => void openOrCreateNoteForItem(currentItemId)}
        onOpenList={openNotesList}
      />
    </div>
  );
}
