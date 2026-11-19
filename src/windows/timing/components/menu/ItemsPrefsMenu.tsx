/** Timing 常用事项管理卡。 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ITEM_TIMER_MAX_MINUTES,
  ITEM_TIMER_MIN_MINUTES,
  itemTimerMinutes,
  movedList,
  withItemTimer,
} from '../../lib/commonItems';
import { placeMenu } from '../../lib/menuPlacement';
import { itemApi, rawIpcText, settingsApi } from '../../services/api';
import { errorText } from '../../services/ipc';
import { useItemTags } from '../../hooks/useItemTags';
import { useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { Item } from '../../types/domain';
import { ItemsPrefsForm } from './ItemsPrefsForm';
import { ItemsPrefsRecentRow } from './ItemsPrefsRecentRow';
import { ItemsPrefsRow } from './ItemsPrefsRow';
import { ItemsPrefsTags } from './ItemsPrefsTags';
import { trapMenuTab, useMenuFocusTrap } from './useMenuFocusTrap';
import '../../styles/common-items.css';

const W = 248;
/** 贴底留高（再小只剩半行表单），超出部分列表内部滚动 */
const MIN_H = 220;

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
  /* [0.12.3] 标签：编辑中的草稿 + 全量映射（打开管理卡时读一次） */
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const tagState = useItemTags();

  /* 候选 = 已有标签 + 事项名（事项名是隐式同名标签）。
     [0.12.4] 不再掺「分类目录」：分类已不是用户面概念，把它的显示名混进标签候选
     会让用户以为那些是标签，选中之后又是一条同名的新标签。 */
  const tagSuggestions = useMemo(() => {
    const all = new Set<string>();
    for (const list of Object.values(tagState.byItemId)) {
      for (const tag of list) all.add(tag);
    }
    for (const item of items) if (!item.isSystem) all.add(item.name);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [tagState.byItemId, items]);
  const aiCandidates = useMemo(
    () => tagSuggestions.map((tag) => ({ key: tag, label: tag })),
    [tagSuggestions],
  );
  const menuRef = useMenuFocusTrap();

  useEffect(() => setCount(String(settings.itemsRecentCount)), [settings.itemsRecentCount]);
  useEffect(() => {
    if (editingId != null) setDraftTags(tagState.byItemId[editingId] ?? []);
  }, [editingId, tagState.byItemId]);

  const notify = (err: unknown) => useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  const notifyAi = (err: unknown) => useUiStore.getState().setNotice({ text: rawIpcText(err), tone: 'danger' });

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
    setDraftTags([]);
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setName(item.name);
    setDraftTags(tagState.byItemId[item.id] ?? []);
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
          await tagState.save(editingId, draftTags);
          await patchSettings({ itemsTimers: withItemTimer(timers, editingId, safeMinutes) });
        } else {
          const nextOrder = pinned.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
          const created = await itemApi.create({ name: label });
          if (draftTags.length > 0) await tagState.save(created.id, draftTags);
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

  const handleCountKey = (clamped: number) => {
    setCount(String(clamped));
    if (clamped !== settings.itemsRecentCount) void patchSettings({ itemsRecentCount: clamped });
  };

  const placement = useMemo(() => placeMenu(anchor, W, MIN_H), [anchor]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} aria-hidden />
      <div
        className="menu items-prefs"
        ref={menuRef}
        role="dialog"
        aria-modal="true"
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
            return;
          }
          trapMenuTab(event, menuRef.current);
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
          tagsSlot={(
            <ItemsPrefsTags
              itemName={name}
              value={draftTags}
              suggestions={tagSuggestions}
              candidates={aiCandidates}
              disabled={busy}
              onChange={setDraftTags}
              onError={notifyAi}
            />
          )}
          busy={busy}
          onName={setName}
          onMinutes={setMinutes}
          onSubmit={submit}
          onCancel={editingId != null ? resetForm : onClose}
        />

        <div className="menu__sep" />

        <ItemsPrefsRecentRow
          showRecent={settings.itemsShowRecent}
          count={count}
          onCountChange={setCount}
          onCommitCount={handleCountKey}
          onToggle={() => void patchSettings({ itemsShowRecent: !settings.itemsShowRecent })}
        />
      </div>
    </>
  );
}
