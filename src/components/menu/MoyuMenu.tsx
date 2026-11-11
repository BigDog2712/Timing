/**
 * Timing — 摸鱼菜单 MoyuMenu（V0.3.2 / V0.3.9 重做内容源）
 * -----------------------------------------------------------------------------
 * 触发（暂停态）：
 *   - 右键时间数字；
 *   - **暂停瞬间自动弹出**（V0.3.8 连招，见 `usePauseMoyu`）。
 *
 * 内容（V0.3.9）：
 *   - 「常用摸鱼」= **应用内置**条目（`Settings.moyuPresets`，可增删改 + 排序），
 *     每条带计时方式：倒计时行右侧显示目标时长，正计时行显示「正计时」；
 *   - 「其他事项…」= 现输名称 + 滚轮定长（倒计时，见 `MoyuCustom`）；
 *   - 「管理常用摸鱼…」= 增删改 + 上下移排序（见 `MoyuManage`）。
 *
 * 已下线（用户口径：鼠标可直接完成，留着只是噪音）：
 *   继续计时 / 结束并保存 / 放弃这次——分别由点圆环、右键圆环、以及记录列表承担。
 *
 * 选条目 = **结束当前并开始**：当前那段按「最短记录时长」判定——低于阈值直接丢弃
 * （不产生记录），否则照常落盘。两种情况下**都不弹撤销条**（见 `moyuActions`）。
 */
import { useMemo, useState } from 'react';
import { useTimerTick } from '../../hooks/useTimerTick';
import { formatClockTime, formatDuration, formatMinutes } from '../../lib/format';
import { ClockIcon, InboxIcon, SettingsIcon, TimerIcon } from '../../lib/icons';
import { moyuActions } from '../../services/moyuActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { MoyuMenuState } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry, type MenuStatus } from './GlassMenu';
import { MoyuCustom } from './MoyuCustom';
import { MoyuManage } from './MoyuManage';

interface MoyuMenuProps {
  state: MoyuMenuState;
}

type MoyuView = 'menu' | 'custom' | 'manage';

export function MoyuMenu({ state }: MoyuMenuProps) {
  const presets = useSettingsStore((s) => s.settings.moyuPresets);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const items = useItemStore((s) => s.items);
  const liveSec = useTimerTick();
  const close = useUiStore((s) => s.closeMoyuMenu);
  const [view, setView] = useState<MoyuView>('menu');

  const active = status !== 'idle';
  const paused = status === 'paused';

  const entries = useMemo<MenuEntry[]>(() => {
    const rows: MenuEntry[] = [{ type: 'group', id: 'g-quick', label: '常用摸鱼' }];

    if (presets.length === 0) {
      rows.push({
        type: 'item',
        id: 'empty',
        label: '还没有条目，点下方「管理常用摸鱼…」添加',
        icon: InboxIcon,
        disabled: true,
        onSelect: () => undefined,
      });
    }

    presets.forEach((preset) => {
      const countdown = preset.mode === 'countdown';
      rows.push({
        type: 'item',
        id: `preset-${preset.id}`,
        label: preset.item,
        icon: countdown ? TimerIcon : ClockIcon,
        accel: countdown ? formatMinutes(preset.minutes * 60) : '正计时',
        onSelect: () => {
          void moyuActions.start(preset.item, preset.mode, preset.minutes, active);
        },
      });
    });

    rows.push({ type: 'separator', id: 'sep-other' });
    rows.push({
      type: 'item',
      id: 'custom',
      label: '其他事项…',
      icon: ClockIcon,
      keepOpen: true,
      onSelect: () => setView('custom'),
    });
    rows.push({
      type: 'item',
      id: 'manage',
      label: '管理常用摸鱼…',
      icon: SettingsIcon,
      keepOpen: true,
      onSelect: () => setView('manage'),
    });

    return rows;
  }, [presets, active]);

  const statusBlock = useMemo<MenuStatus | null>(() => {
    if (!session) return null;
    const name = findItem(items, session.itemId)?.name ?? '未归类';
    const isCountdown = session.mode === 'countdown' && session.targetSec != null;
    const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - liveSec) : 0;
    return {
      title: name,
      meta: formatClockTime(session.startedAt),
      detail: isCountdown
        ? `${paused ? '已暂停' : '倒计时'} · 剩 ${formatDuration(remaining)}`
        : `${paused ? '已暂停' : '计时中'} · ${formatDuration(liveSec)}`,
    };
  }, [session, items, liveSec, paused]);

  if (view === 'custom') {
    return (
      <MoyuCustom
        anchor={state.pos}
        onCancel={() => setView('menu')}
        onStart={(name, minutes) => {
          close();
          void moyuActions.start(name, 'countdown', minutes, active);
        }}
      />
    );
  }

  if (view === 'manage') {
    return <MoyuManage anchor={state.pos} onBack={() => setView('menu')} />;
  }

  return (
    <GlassMenu
      entries={entries}
      status={statusBlock}
      anchor={state.pos}
      ariaLabel="摸鱼菜单"
      onClose={close}
      className="menu--moyu"
      /* [P0-07] 计时语义：摸鱼（倒计时 / 正计时）属「计时」，写 time_records、计入时间账。 */
      footer={<span data-countdown-ledger="counted">计时 · 计入时间账</span>}
      /* 自动弹出时指针还在小条上：**先移入再移出**才计时收起，宽限 1s（V0.3.9） */
      hoverClose={{ graceMs: 1000, requireEnter: true }}
    />
  );
}
