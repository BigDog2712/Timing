/**
 * TickBar — 常用事项 CommonItems（common-items.md · V0.2.0 新增 N-7）
 * -----------------------------------------------------------------------------
 * 触发：左键点小条事项名 / 托盘「编辑固定任务…」（app:open-common-items）。
 * 形态：**复用 GlassMenu 的自绘玻璃菜单**（键盘 ↑↓ Home End Enter Esc + P）。
 *   - 固定任务（items.isPinned）置顶，pin 图标；不设硬上限（滚动）。
 *   - 常用事项：最近使用 5 条 —— 由 list_records 最近记录**前端派生**（证据不足则按
 *     「固定任务 + 全部 active 事项（sortOrder）」补齐）。
 *   - 引用命令**仅限 Spec §5 锁定集**：listItems / listRecords / updateItem({isPinned}) / startTimer。
 *     （common-items.md 提到的 item_list_recent / item_pin 不在锁定集内，**禁止新增**。）
 *   - 点当前正在计时的事项 → end_and_start 切换确认；其余 → 直接 startTimer。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import { PinIcon, PlayIcon, PlusIcon } from '../../lib/icons';
import { itemsActions } from '../../services/itemsActions';
import { useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { Item } from '../../types/domain';
import { GlassMenu, type MenuEntry } from '../menu/GlassMenu';

/** 最近使用条目数（common-items.md §3.1 size.commonRecentCount = 5） */
const RECENT_COUNT = 5;

interface CommonItemsProps {
  anchor: MenuPos;
}

export function CommonItems({ anchor }: CommonItemsProps) {
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const close = useUiStore((s) => s.closeCommonItems);

  /** itemId -> 最近一次倒计时目标（秒）；派生自 list_records */
  const [presets, setPresets] = useState<Record<number, number>>({});
  /** 按最近使用排序的事项 id（派生自 list_records） */
  const [recentIds, setRecentIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void itemsActions.loadRecentContext().then((ctx) => {
      if (cancelled) return;
      setRecentIds(ctx.recentIds);
      setPresets(ctx.countdownPresets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 固定任务：isPinned，按 sortOrder */
  const pinned = useMemo(() => items.filter((i) => i.isPinned), [items]);

  /** 常用事项：最近使用 5 条；不足则按 sortOrder 补齐 active 事项 */
  const recent = useMemo<Item[]>(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const out: Item[] = [];
    for (const id of recentIds) {
      const it = byId.get(id);
      if (it && !out.includes(it)) out.push(it);
      if (out.length >= RECENT_COUNT) break;
    }
    if (out.length < RECENT_COUNT) {
      for (const it of items) {
        if (!out.includes(it)) out.push(it);
        if (out.length >= RECENT_COUNT) break;
      }
    }
    return out;
  }, [items, recentIds]);

  /** 信息位：倒计时预设 > 正计时 > 空 */
  const infoFor = (it: Item): string => {
    if (session?.itemId === it.id && session.mode === 'countup') return '正计时';
    const sec = presets[it.id];
    if (sec != null) return `倒计时 ${Math.round(sec / 60)} 分`;
    return '';
  };

  const startItem = (it: Item) => {
    if (status !== 'idle' && session && session.itemId !== it.id) void actions.switchTo(it.id, 'end_and_start');
    else void actions.start(it.id);
  };

  const togglePin = (it: Item) => {
    void itemsActions.setPinned(it.id, !it.isPinned).catch(() => undefined);
  };

  const entries = useMemo<MenuEntry[]>(() => {
    const rows: MenuEntry[] = [];
    if (items.length === 0) {
      rows.push({ type: 'group', id: 'g-empty', label: '还没有记录，先新建一个' });
    }
    if (pinned.length > 0) {
      rows.push({ type: 'group', id: 'g-pin', label: '固定任务' });
      for (const it of pinned) {
        rows.push({
          type: 'item',
          id: `pin-${it.id}`,
          label: it.name,
          icon: PinIcon,
          accel: infoFor(it) || undefined,
          onSelect: () => startItem(it),
        });
      }
    }
    if (recent.length > 0) {
      rows.push({ type: 'group', id: 'g-recent', label: '常用事项' });
      for (const it of recent) {
        rows.push({
          type: 'item',
          id: `recent-${it.id}`,
          label: it.name,
          icon: PlayIcon,
          accel: infoFor(it) || undefined,
          checked: session?.itemId === it.id,
          onSelect: () => startItem(it),
        });
      }
    }
    rows.push({ type: 'separator', id: 'sep-other' });
    rows.push({
      type: 'item',
      id: 'other',
      label: '其他事项…',
      icon: PlusIcon,
      onSelect: () => useUiStore.getState().openPanel('create'),
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- infoFor/startItem 依赖已由下方覆盖
  }, [items, pinned, recent, session, status, presets]);

  /** ↑↓ 聚焦到哪一项（含 group/separator 下标），供 P 键定位 */
  const itemAt = (index: number): Item | null => {
    const entry = entries[index];
    if (!entry || entry.type !== 'item') return null;
    const id = Number(entry.id.split('-')[1]);
    const all = [...pinned, ...recent];
    return all.find((i) => i.id === id) ?? null;
  };

  const handleExtraKey = (key: string, index: number): boolean => {
    if (key !== 'p' && key !== 'P') return false;
    const it = itemAt(index);
    if (!it) return false;
    togglePin(it);
    return true;
  };

  return (
    <GlassMenu
      entries={entries}
      anchor={anchor}
      ariaLabel="常用事项"
      onClose={close}
      className="menu--common"
      onExtraKey={handleExtraKey}
    />
  );
}
