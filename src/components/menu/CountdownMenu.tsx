/**
 * Timing — 时长菜单 CountdownMenu（countdown-menu.md · V0.2.0 新增 N-6）
 * -----------------------------------------------------------------------------
 * 触发：小条右键数字 / 事项右键「倒计时…」。形态：**复用 GlassMenu 的自绘玻璃菜单**。
 * [V0.2.5 · 5] 语义改为参照 Timing v1.7.3 的「先设定、再开始」：
 *   - 点档位 = 只**设定**时长（`useCountdownArmStore.arm`），不立刻开跑；
 *     当前已设定的那一档显示勾选态（参照版是把当前值那行置灰）。
 *   - 「开始倒计时」才真正 start；「改为正计时」清掉设定、回到 00:00。
 *   - 「自定义…」同样只设定。计时中选档位会走「结束当前并开始」的旧口径（显式点开始）。
 * 到点行为归 Rust（1s watcher）；前端只做视觉提示（订阅 countdown-finished）。
 */
import { useMemo, useState } from 'react';
import { useTimerTick } from '../../hooks/useTimerTick';
import { defaultCountdownSec } from '../../lib/countdown';
import { formatClockTime, formatDuration } from '../../lib/format';
import { ClockIcon, PlayIcon, RepeatIcon, TimerIcon } from '../../lib/icons';
import { countdownActions } from '../../services/countdownActions';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useItemStore, findItem } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { CountdownMenuState } from '../../stores/uiStore';
import { GlassMenu, type MenuEntry, type MenuStatus } from './GlassMenu';
import { CountdownCustom } from './CountdownCustom';

/** 九档预设沿用 Timing v1.7.3 倒计时菜单的固定档位（参考版不可配置） */
const REFERENCE_PRESETS = [300, 600, 900, 1500, 1800, 2700, 3600, 4500, 5400] as const;

interface CountdownMenuProps {
  state: CountdownMenuState;
}

export function CountdownMenu({ state }: CountdownMenuProps) {
  const anchor = state.pos;
  const presets = REFERENCE_PRESETS;  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const liveSec = useTimerTick();
  const close = useUiStore((s) => s.closeCountdownMenu);
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  /* [P1 优化] 「自定义…」的初值同样取参考设置的默认倒计时，不再是硬编码 25 分钟 */
  const defaultSec = useSettingsStore((s) => defaultCountdownSec(s.referenceSettings));
  const arm = useCountdownArmStore((s) => s.arm);
  const clearArm = useCountdownArmStore((s) => s.clear);
  const [custom, setCustom] = useState(state.custom ?? false);

  const active = status !== 'idle';
  /* 目标事项优先级：菜单携带（事项右键）> 进行中会话 > 最近使用 */
  const targetItemId = state.itemId ?? session?.itemId ?? lastItemId ?? undefined;

  /** 真正开跑：idle 直接开；计时中先 stop_timer 落盘再开（「结束当前并开始」） */
  const start = (targetSec: number) => {
    arm(targetSec);
    void countdownActions.start(targetItemId, targetSec, active);
    close();
  };

  const entries = useMemo<MenuEntry[]>(() => {
    const rows: MenuEntry[] = presets.map((sec) => ({
      type: 'item',
      id: `preset-${sec}`,
      label: `${Math.round(sec / 60)} 分钟`,
      icon: TimerIcon,
      accel: formatDuration(sec),
      checked: armedSec === sec,
      disabled: armedSec === sec,
      /* 点档位只设定时长，等「开始倒计时」——参照版也是这么两步走 */
      onSelect: () => {
        arm(sec);
        close();
      },
    }));
    rows.push({ type: 'separator', id: 'sep-custom' });
    rows.push({
      type: 'item',
      id: 'custom',
      label: '输入分 / 秒…',
      icon: ClockIcon,
      onSelect: () => setCustom(true),
    });
    rows.push({ type: 'separator', id: 'sep-actions' });
    rows.push({
      type: 'item',
      id: 'start',
      label: armedSec ? `开始倒计时 · ${formatDuration(armedSec)}` : '开始倒计时',
      icon: PlayIcon,
      disabled: armedSec == null,
      onSelect: () => {
        if (armedSec != null) start(armedSec);
      },
    });
    rows.push({
      type: 'item',
      id: 'to-countup',
      label: '改为正计时',
      icon: RepeatIcon,
      disabled: armedSec == null,
      onSelect: () => {
        clearArm();
        close();
      },
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/arm/close 均为稳定闭包
  }, [presets, armedSec, active, targetItemId]);

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
        initialSec={armedSec ?? defaultSec}
        onCancel={() => setCustom(false)}
        onSubmit={(sec) => {
          setCustom(false);
          /* 同样只设定，不立刻开跑 */
          arm(sec);
          close();
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
      /* [P0-07] 计时语义：倒计时属「计时」，写 time_records、计入时间账（与工具的专注会话相反）。 */
      footer={<span data-countdown-ledger="counted">计时 · 计入时间账</span>}
    />
  );
}
