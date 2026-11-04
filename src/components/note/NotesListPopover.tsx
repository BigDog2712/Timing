/**
 * Timing — 便利贴清单 NotesListPopover（V0.2.1 · 手柄右键唤出）
 * -----------------------------------------------------------------------------
 * 触发：药丸右侧手柄右键（PillBar → uiStore.openNotesList，锚点为手柄左下）。
 * 内容：全部便利贴（最近更新在前，最多 MAX_ROWS 条）+ 一条「写一张新的…」；
 *   行右侧信息位 = 关联事项名，未关联显示日期。点击行 → 开该便利贴窗（note-{id}）。
 * 口子：菜单外观复用 GlassMenu（玻璃板 / 键盘 ↑↓ Enter Esc / 贴边钳制），不另造浮层。
 * 空态：没有便利贴时只显示一行提示，仍可点「写一张新的…」。
 */
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, StickyNoteIcon } from '../../lib/icons';
import { listNotes, openNewNote, openNoteWindowFor } from '../../services/noteActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import type { MenuPos } from '../../stores/uiStore';
import type { Note } from '../../types/domain-v020';
import { GlassMenu, type MenuEntry } from '../menu/GlassMenu';

const MAX_ROWS = 5;

/** 正文首行 → 清单标题（空正文 = 未命名） */
function titleOf(note: Note): string {
  const first = note.content.split('\n', 1)[0]?.trim() ?? '';
  if (first.length === 0) return '未命名便利贴';
  return first.length > 18 ? `${first.slice(0, 18)}…` : first;
}

/** 行右侧信息位：优先关联事项名，否则更新日期 */
function metaOf(note: Note, itemName: string | undefined): string {
  if (itemName) return itemName.length > 6 ? `${itemName.slice(0, 6)}…` : itemName;
  const d = new Date(note.updatedAt);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface NotesListPopoverProps {
  pos: MenuPos;
  onClose: () => void;
}

export function NotesListPopover({ pos, onClose }: NotesListPopoverProps) {
  const items = useItemStore((s) => s.items);
  const itemId = useTimerStore((s) => s.state.session?.itemId ?? s.state.lastItemId);
  const [notes, setNotes] = useState<Note[] | null>(null);

  /* 打开即拉全量（后端一次 note_list，无过滤）；失败按空清单兜底，不阻塞其它入口 */
  useEffect(() => {
    let alive = true;
    void listNotes()
      .then((rows) => {
        if (alive) setNotes(rows.slice().sort((a, b) => b.updatedAt - a.updatedAt));
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const entries = useMemo<MenuEntry[]>(() => {
    const rows = (notes ?? [])
      .filter((note) => note.itemId == null || note.itemId === itemId)
      .slice(0, MAX_ROWS);
    const list: MenuEntry[] = [
      { type: 'group', id: 'notes-head', label: notes == null ? '便利贴' : `便利贴 · ${notes.length} 张` },
    ];
    if (notes != null && rows.length === 0) {
      list.push({ type: 'item', id: 'notes-empty', label: '还没有便利贴', icon: StickyNoteIcon, disabled: true, onSelect: () => undefined });
    }
    for (const note of rows) {
      const itemName = note.itemId != null ? findItem(items, note.itemId)?.name : undefined;
      list.push({
        type: 'item',
        id: `note-${note.id}`,
        label: titleOf(note),
        icon: StickyNoteIcon,
        accel: metaOf(note, itemName),
        onSelect: () => void openNoteWindowFor(note.id),
      });
    }
    list.push({ type: 'separator', id: 'notes-sep' });
    list.push({ type: 'item', id: 'notes-new', label: '写一张新的…', icon: PlusIcon, onSelect: () => void openNewNote() });
    return list;
  }, [notes, items, itemId]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} aria-hidden />
      <GlassMenu
        entries={entries}
        anchor={pos}
        ariaLabel="便利贴清单"
        onClose={onClose}
        className="menu--notes"
      />
    </>
  );
}
