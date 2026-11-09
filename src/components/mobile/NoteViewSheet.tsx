/**
 * Timing — 便利贴「看整张」（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 主人原话：「点击便利贴可弹出查看完整便利贴」。
 *
 * 列表行里正文 `-webkit-line-clamp: 2`，两行封顶 —— 那只够认出是哪一张。原先点行
 * 直接进**编辑页**，长正文被压在一个 168px 高的输入框里滚，看到的还是开头两行；
 * 手机上"点开看全文"和"点开改内容"是两件事，挤在一个面板里两边都别扭。
 *
 * 这一屏只读：全文按原样折行、整页可滚，信息（归属 / 时间）一次看全；
 * 真要改再点底部的「编辑」，落到 `noteEdit`（那边仍然是原来那套落盘口径）。
 *
 * 为什么不在这里放删除：列表行尾已有删除键、编辑页有「删除」二次确认，
 * 同一个面板再放第三个删除入口，只会让人在只读一屏里误触。
 */
import { useEffect, useState } from 'react';
import { formatClockTime } from '../../lib/format';
import { LinkIcon, StickyNoteIcon, iconStroke } from '../../lib/icons';
import { getNote } from '../../services/mobileNoteActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import type { Note } from '../../types/domain';
import { Sheet } from './Sheet';

interface NoteViewSheetProps {
  noteId: number;
}

export function NoteViewSheet({ noteId }: NoteViewSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const items = useItemStore((s) => s.items);

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  /* 便利贴可能在另一个窗口/另一边被删掉：读不到要给一句话，不能空着当"没有正文" */
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const loaded = await getNote(noteId);
      if (cancelled) return;
      if (!loaded) setMissing(true);
      else setNote(loaded);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const text = note?.content.trim() ?? '';
  const owner = note?.itemId == null ? '随记' : itemName(items, note.itemId);

  return (
    <Sheet
      title="便利贴"
      onClose={() => closeSheet('noteView')}
      footer={
        <div className="m-sheet__foot-row">
          <button
            type="button"
            className="m-btn m-btn--primary m-field--grow"
            onClick={() => openSheet({ kind: 'noteEdit', noteId })}
          >
            编辑
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="m-empty">正在打开…</p>
      ) : missing ? (
        <p className="m-empty">这张便利贴已经不在了</p>
      ) : (
        <>
          <div className="m-note__full" data-empty={text.length === 0 ? 'true' : 'false'}>
            {text.length === 0 ? '空白便利贴' : text}
          </div>

          <p className="m-note__viewmeta">
            <span className="m-note__viewowner">
              <LinkIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              {owner}
            </span>
            <span className="m-note__viewtime">
              <StickyNoteIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              {formatClockTime(note?.updatedAt)}
              {note && note.updatedAt !== note.createdAt
                ? `（写于 ${formatClockTime(note.createdAt)}）`
                : ''}
            </span>
          </p>
        </>
      )}
    </Sheet>
  );
}
