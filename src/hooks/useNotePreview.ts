/**
 * TickBar — 事项窗「便利贴预览」状态机（V0.3.9）
 * -----------------------------------------------------------------------------
 * 用户口径：事项窗里悬停事项行时，若该事项有便利贴，在该事项左侧预览它。
 *
 * 职责只有状态：拉一次全量便利贴（`note_list` 无过滤）、按 itemId 取最近更新的那张、
 * 悬停时记住行顶位置（供卡片贴行）；离开行 / 卡片后 160ms 再收（跨过缝隙不闪）。
 * 渲染交给 `NotePreview`（它自己 portal 到 body，见该文件注释）。
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { listNotes } from '../services/noteActions';
import type { Note } from '../types/domain-v020';

export interface NotePreviewAnchor {
  itemId: number;
  /** 悬停行在视口中的 top（卡片贴这一行） */
  top: number;
}

export interface NotePreviewControl {
  preview: NotePreviewAnchor | null;
  /** 当前预览的那张便利贴（随预览状态一起返回，省得调用方再查一次） */
  note: Note | undefined;
  /** 行的 onMouseEnter */
  hoverStart: (itemId: number) => (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** 行的 onMouseLeave（延迟收起） */
  hoverEnd: () => void;
  /** 指针移进预览卡：取消待收起 */
  keepOpen: () => void;
  /** 点卡片 / 关窗：立即收 */
  closeNow: () => void;
}

const CLOSE_DELAY_MS = 160;

export function useNotePreview(): NotePreviewControl {
  const [notes, setNotes] = useState<Note[]>([]);
  const [preview, setPreview] = useState<NotePreviewAnchor | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void listNotes()
      .then((rows) => setNotes(rows))
      .catch(() => undefined);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  /** 该事项最近更新的那张便利贴；没有 → undefined（没有就不弹） */
  const noteOf = (itemId: number): Note | undefined =>
    notes.filter((n) => n.itemId === itemId).sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const cancel = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const hoverStart = (itemId: number) => (e: ReactMouseEvent<HTMLDivElement>) => {
    cancel();
    const top = e.currentTarget.getBoundingClientRect().top;
    if (noteOf(itemId)) {
      setPreview({ itemId, top });
      return;
    }
    setPreview(null);
    /* 窗开着的时候新写了便利贴（右键「便利贴…」）：缓存里没有就按事项补拉一次 */
    void listNotes(itemId)
      .then((rows) => {
        if (rows.length === 0) return;
        setNotes((prev) => [...prev.filter((n) => n.itemId !== itemId), ...rows]);
        setPreview({ itemId, top });
      })
      .catch(() => undefined);
  };

  const hoverEnd = () => {
    cancel();
    timer.current = window.setTimeout(() => setPreview(null), CLOSE_DELAY_MS);
  };

  const closeNow = () => {
    cancel();
    setPreview(null);
  };

  return {
    preview,
    note: preview ? noteOf(preview.itemId) : undefined,
    hoverStart,
    hoverEnd,
    keepOpen: cancel,
    closeNow,
  };
}
