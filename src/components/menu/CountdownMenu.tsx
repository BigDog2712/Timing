/**
 * TickBar — 时长菜单 CountdownMenu（countdown-menu.md · V0.2.0 新增 N-6）
 * -----------------------------------------------------------------------------
 * 触发：小条右键 / 事项右键「倒计时…」。形态：**复用 GlassMenu 的自绘玻璃菜单**
 * （与 context-menu 同一套语言 / 键盘 ↑↓ Home End Enter Esc 可达）。
 *   - 预设来自 settings.countdownPresets（AC-62；出厂 5/15/25/45 分），右侧等宽 MM:SS。
 *   - 「自定义…」→ 分钟/秒输入（< 1 分钟提示；上限 MAX_COUNTDOWN_SEC）。
 *   - 计时中（含倒计时中）→ 追加「结束当前并开始」：先 stop_timer 落盘再 start_countdown。
 * 到点行为归 Rust（1s watcher）；前端只做视觉提示（订阅 countdown-finished，见 useAppBootstrap）。
 */
import { useMemo, useState } from 'react';
import { useTimerTick } from '../../hooks/useTimerTick';
import { formatClockTime, formatDuration } from '../../lib/format';
import { ClockIcon, RepeatIcon, TimerIcon } from '../../lib/icons';
import { countdownActions } from '../../services/countdownActions';
import { useItemStore, findItem } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { CountdownMenuState } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry, type MenuStatus } from './GlassMenu';
import { CountdownCustom } from './CountdownCustom';

/** 最近一次使用的倒计时时长（「结束当前并开始」沿用；模块级会话内记忆） */
let lastUsedSec = 0;

interface CountdownMenuProps {
  state: CountdownMenuState;
}

export function CountdownMenu({ state }: CountdownMenuProps) {
  const anchor = state.pos;
  const presets = useSettingsStore((s) => s.settings.countdownPresets);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const liveSec = useTimerTick();
  const close = useUiStore((s) => s.closeCountdownMenu);
  const [custom, setCustom] = useState(false);

  const active = status !== 'idle';
  /* 目标事项优先级：菜单携带（事项右键）> 进行中会话 > 最近使用 */
  const targetItemId = state.itemId ?? session?.itemId ?? lastItemId ?? undefined;

  /** 启动倒计时：idle 直接开；计时中先 stop_timer 落盘再开（「结束当前并开始」） */
  const start = (targetSec: number) => {
    lastUsedSec = targetSec;
    void countdownActions.start(targetItemId, targetSec, active);
  };

  const entries = useMemo<MenuEntry[]>(() => {
    const rows: MenuEntry[] = presets.map((sec) => ({
      type: 'item',
      id: `preset-${sec}`,
      label: `${Math.round(sec / 60)} 分钟`,
      icon: TimerIcon,
      accel: formatDuration(sec),
      onSelect: () => void start(sec),
    }));
    rows.push({ type: 'separator', id: 'sep-custom' });
    rows.push({
      type: 'item',
      id: 'custom',
      label: '自定义…',
      icon: ClockIcon,
      onSelect: () => setCustom(true),
    });
    if (active) {
      rows.push({
        type: 'item',
        id: 'restart',
        label: '结束当前并开始',
        icon: RepeatIcon,
        onSelect: () => void start(lastUsedSec || presets[0] || 300),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start 为稳定闭包（仅依赖当前快照）
  }, [presets, active, targetItemId]);

  const statusBlock = useMemo<MenuStatus | null>(() => {
    if (!session) return null;
    const name = findItem(items, session.itemId)?.name ?? '未归类';
    const isCountdown = session.mode === 'countdown' && session.targetSec != null;
    const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - liveSec) : 0;
    return {
      title: name,
      meta: formatClockTime(session.startedAt),
      detail: isCountdown ? `倒计时 · 剩 ${formatDuration(remaining)}` : `计时中 · ${formatDuration(liveSec)}`,
      tone: 'accent',
    };
  }, [session, items, liveSec]);

  if (custom) {
    return (
      <CountdownCustom
        anchor={anchor}
        active={active}
        onCancel={() => setCustom(false)}
        onSubmit={(sec) => {
          setCustom(false);
          void start(sec);
        }}
      />
    );
  }

  return (
    <GlassMenu
      entries={entries}
      status={statusBlock}
      anchor={anchor}
      ariaLabel="倒计时时长"
      onClose={close}
      className="menu--countdown"
    />
  );
}
