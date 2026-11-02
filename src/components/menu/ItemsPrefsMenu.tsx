/**
 * TickBar — 常用事项 · 管理卡 ItemsPrefsMenu（V0.3.9）
 * -----------------------------------------------------------------------------
 * 入口：常用事项框右下角的小圆点（`CommonItems` footer）。
 *
 * 形态**对齐摸鱼管理**（用户口径：参考摸鱼事项管理，可拖动、新增、设置倒计时）：
 *   1. 列表 = 已置顶的**常用事项**：拖手柄排序（`ItemsPrefsRow`，手柄上 ↑/↓ 也可），落库写 `sort_order`；
 *   2. 新增 / 编辑共用 `ItemsPrefsForm`：名称 + 默认倒计时（留空 = 正计时）；
 *   3. 删除 = **移出常用**（取消置顶），事项本身保留；
 *   4. 「显示最近事项」开 = 高亮色、关 = 常规色（无图标无对勾），条数填在行右侧（默认 5，钳 1..10）。
 *
 * 时长落 `settings.itemsTimers`（itemId → 分钟），不建表、不动 IPC 契约。
 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  ITEM_TIMER_MAX_MINUTES,
  ITEM_TIMER_MIN_MINUTES,
  itemTimerMinutes,
  movedList,
  withItemTimer,
} from '../../lib/commonItems';
import { fitBounds } from '../../lib/fitBounds';
import { itemApi, settingsApi } from '../../services/api';
import { errorText } from '../../services/ipc';
import { useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { Item } from '../../types/domain';
import { ItemsPrefsForm } from './ItemsPrefsForm';
import { ItemsPrefsRow } from './ItemsPrefsRow';
import '../../styles/common-items.css';

const W = 248;
const EDGE = 4;
/** 贴底留高（再小只剩半行表单），超出部分列表内部滚动 */
const MIN_H = 220;
const RECENT_DEFAULT = 5;
const RECENT_MIN = 1;
const RECENT_MAX = 10;

interface ItemsPrefsMenuProps {
  anchor: MenuPos;
  onClose: () => void;
}

export function ItemsPrefsMenu({ anchor, onClose }: ItemsPrefsMenuProps) {
  const items = useItemStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);
  const timers = settings.itemsTimers;

  const pinned = useMemo(
    () =>
      items
        .filter((item) => item.isPinned && !item.isSystem)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [items],
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(String(settings.itemsRecentCount));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => setCount(String(settings.itemsRecentCount)), [settings.itemsRecentCount]);

  const notify = (err: unknown) =>
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });

  const patchSettings = async (patch: Parameters<typeof settingsApi.update>[0]) => {
    try {
      const saved = await settingsApi.update(patch);
      useSettingsStore.getState().setSettings(saved);
    } catch (err) {
      notify(err);
    }
  };

  const reloadItems = () => useItemStore.getState().reload();

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setMinutes('');
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setName(item.name);
    const current = itemTimerMinutes(timers, item.id);
    setMinutes(current != null ? String(current) : '');
  };

  /** 表单值 → 合法分钟数；留空 / 非法 = null（正计时） */
  const readMinutes = (): number | null => {
    const raw = minutes.trim();
    if (raw === '') return null;
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed)) return null;
    return Math.min(ITEM_TIMER_MAX_MINUTES, Math.max(ITEM_TIMER_MIN_MINUTES, parsed));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const label = name.trim();
    if (label.length === 0 || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const safeMinutes = readMinutes();
        if (editingId != null) {
          await itemApi.update({ id: editingId, patch: { name: label } });
          await patchSettings({ itemsTimers: withItemTimer(timers, editingId, safeMinutes) });
        } else {
          const nextOrder = pinned.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
          const created = await itemApi.create({ name: label });
          await itemApi.update({ id: created.id, patch: { isPinned: true, sortOrder: nextOrder } });
          if (safeMinutes != null) {
            await patchSettings({ itemsTimers: withItemTimer(timers, created.id, safeMinutes) });
          }
        }
        await reloadItems();
        resetForm();
      } catch (err) {
        notify(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  /** 移出常用（取消置顶）；事项本身与它的时长偏好都保留 */
  const remove = (item: Item) => {
    if (busy) return;
    if (editingId === item.id) resetForm();
    setBusy(true);
    void (async () => {
      try {
        await itemApi.update({ id: item.id, patch: { isPinned: false } });
        await reloadItems();
      } catch (err) {
        notify(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  /** 整组重排：把 from 挪到 to，然后把 0..n-1 逐条写回 sort_order */
  const reorder = (from: number, to: number) => {
    if (busy || from === to) return;
    const next = movedList(pinned, from, to);
    setBusy(true);
    void (async () => {
      try {
        for (let i = 0; i < next.length; i += 1) {
          await itemApi.update({ id: next[i].id, patch: { sortOrder: i } });
        }
        await reloadItems();
      } catch (err) {
        notify(err);
      } finally {
        setBusy(false);
      }
    })();
  };

  const shift = (index: number, delta: number) => reorder(index, index + delta);
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  const dropAt = (index: number) => {
    if (dragFrom != null) reorder(dragFrom, index);
    endDrag();
  };

  const commitCount = () => {
    const parsed = Math.round(Number(count));
    const clamped = Number.isFinite(parsed)
      ? Math.min(RECENT_MAX, Math.max(RECENT_MIN, parsed))
      : RECENT_DEFAULT;
    setCount(String(clamped));
    if (clamped !== settings.itemsRecentCount) void patchSettings({ itemsRecentCount: clamped });
  };

  const handleCountKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitCount();
    }
  };

  const placement = useMemo(() => {
    const viewport = fitBounds();
    const leftEdge = viewport.x + EDGE;
    const topEdge = viewport.y + EDGE;
    const left = Math.min(
      Math.max(anchor.x, leftEdge),
      Math.max(leftEdge, viewport.x + viewport.w - W - EDGE),
    );
    const top = Math.min(
      Math.max(anchor.y, topEdge),
      Math.max(topEdge, viewport.y + viewport.h - MIN_H - EDGE),
    );
    return { left, top, maxHeight: Math.max(MIN_H, viewport.y + viewport.h - top - EDGE) };
  }, [anchor.x, anchor.y]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} aria-hidden />
      <div
        className="menu items-prefs"
        role="dialog"
        aria-label="常用事项管理"
        style={{
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          width: `${W}px`,
          maxHeight: `${placement.maxHeight}px`,
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="menu__group">常用事项</div>
        <div className="items-prefs__list">
          {pinned.length === 0 && <p className="items-prefs__empty">还没有常用事项</p>}
          {pinned.map((item, index) => (
            <ItemsPrefsRow
              key={item.id}
              item={item}
              index={index}
              timer={itemTimerMinutes(timers, item.id)}
              busy={busy}
              editing={editingId === item.id}
              dropTarget={dragOver === index && dragFrom !== index}
              onEdit={startEdit}
              onRemove={remove}
              onShift={shift}
              onDragStart={setDragFrom}
              onDragEnd={endDrag}
              onDragOverAt={setDragOver}
              onDropAt={dropAt}
            />
          ))}
        </div>

        <div className="menu__sep" />

        <ItemsPrefsForm
          editing={editingId != null}
          name={name}
          minutes={minutes}
          busy={busy}
          onName={setName}
          onMinutes={setMinutes}
          onSubmit={submit}
          onCancel={editingId != null ? resetForm : onClose}
        />

        <div className="menu__sep" />

        <div className="items-prefs__recent">
          <button
            type="button"
            className="items-prefs__toggle"
            data-on={settings.itemsShowRecent}
            aria-pressed={settings.itemsShowRecent}
            onClick={() => void patchSettings({ itemsShowRecent: !settings.itemsShowRecent })}
          >
            显示最近事项
          </button>
          <input
            type="number"
            className="items-prefs__count"
            aria-label="最近事项条数"
            min={RECENT_MIN}
            max={RECENT_MAX}
            step={1}
            value={count}
            disabled={!settings.itemsShowRecent}
            onChange={(event) => setCount(event.target.value)}
            onBlur={commitCount}
            onKeyDown={handleCountKey}
          />
        </div>
      </div>
    </>
  );
}
