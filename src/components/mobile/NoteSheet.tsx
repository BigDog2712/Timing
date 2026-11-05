/**
 * Timing — 移动端便利贴编辑 Sheet（V0.11.0）
 * -----------------------------------------------------------------------------
 * 一张便利贴的全部操作都在这一屏：写正文、改归属、删除。
 *
 * 保存时机（对齐桌面「失焦即落盘」的体感，但手机没有失焦）：
 *   - 输入时不同步落库（每次按键都发 IPC 会把电池和时序都吃掉）；
 *   - 点「完成」、下滑关掉、点遮罩、按返回键 —— 四条退场路径都先落盘再退，
 *     统一走 `Sheet` 的 `onClose`，所以只有一处 flush；
 *   - 组件卸载时兜底再 flush 一次（防止某条路径绕过 onClose）。
 *
 * 空正文的处置与桌面一致（`noteActions.closeNote`）：**清空即删除**。
 * 留下一张看不见的空白贴，用户下次打开列表会莫名其妙。
 *
 * 归属默认取「当前事项」，可在 `noteItem` Sheet 里改，也可以解绑成随记。
 */
import { useEffect, useRef, useState } from 'react';
import { NOTE_CONTENT_MAX_LEN } from '../../types/domain';
import { AlertIcon, LinkIcon, iconStroke } from '../../lib/icons';
import {
  createNote,
  getNote,
  removeNote,
  saveNoteContent,
} from '../../services/mobileNoteActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import type { Note } from '../../types/domain';
import { Sheet } from './Sheet';

interface NoteSheetProps {
  /** null = 新建（进入即建一行，避免用户写了半天才发现不存在） */
  noteId: number | null;
}

/** 删除按钮的「上膛」窗口：第一下只变色提示，3.5s 内再点才真删（与桌面 NoteHeader 同口径） */
const DELETE_ARM_MS = 3500;

export function NoteSheet({ noteId }: NoteSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const bumpNotes = useMobileUiStore((s) => s.bumpNotes);
  const items = useItemStore((s) => s.items);

  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [armed, setArmed] = useState(false);

  /* 只关「自己这一种」Sheet：异步落盘回来时，用户可能已经开了别的 Sheet（如倒计时） */
  const closeMine = () => closeSheet('noteEdit');

  /* 当前行的「活值」：卸载兜底 flush 读它，读 state 会拿到闭包里的旧值。
     saved 是最近一次落盘的正文，与它相同就不发 IPC（同 noteStore 的 savedContent 口径）。 */
  const liveRef = useRef<{ id: number | null; text: string; saved: string }>({
    id: null,
    text: '',
    saved: '',
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const loaded = noteId == null ? await createNote() : await getNote(noteId);
      if (cancelled) return;
      if (!loaded) {
        setError('这张便利贴已经不在了');
        setLoading(false);
        return;
      }
      setNote(loaded);
      setText(loaded.content);
      liveRef.current = { id: loaded.id, text: loaded.content, saved: loaded.content };
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  /**
   * 落盘：内容没变就不发命令；正文为空 → 删除（清空即删除，同桌面口径）。
   * [V0.11.2] 返回「是否成功」——退场路径必须据此决定关不关，否则 IPC 一失败
   * 面板一关，刚写的正文就随组件销毁而消失（库里还是旧内容）。
   */
  const flush = async (): Promise<boolean> => {
    const { id, text: value, saved } = liveRef.current;
    if (id == null) return true;
    if (value.trim().length === 0) {
      const ok = await removeNote(id);
      if (!ok) return false;
      liveRef.current = { id: null, text: '', saved: '' };
      bumpNotes();
      return true;
    }
    if (value === saved) return true;
    const updated = await saveNoteContent(id, value);
    if (!updated) return false;
    liveRef.current = { id: updated.id, text: updated.content, saved: updated.content };
    bumpNotes();
    return true;
  };

  /* 卸载兜底：正常路径已经 flush 过，这里幂等（内容没变直接返回） */
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  const onChange = (value: string) => {
    setText(value);
    liveRef.current = { ...liveRef.current, text: value };
  };

  const finish = async () => {
    const ok = await flush();
    if (!ok) {
      /* 落盘失败：留在这一页，正文还在输入框里，用户能重试 */
      setError('没保存成功，内容还在这页，请再点一次「完成」');
      return;
    }
    closeMine();
  };

  /* 删除上膛：3.5s 无第二下自动回弹，避免按钮一直停在危险态 */
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), DELETE_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const destroy = async () => {
    if (!armed) {
      /* [V0.11.2] 第一下只上膛：原先点一下就永久删除，而「删除」和「完成」并排同尺寸，
         拇指想点完成却落到删除，内容当场没了、也没有撤销。 */
      setArmed(true);
      return;
    }
    const id = liveRef.current.id;
    if (id == null) {
      closeMine();
      return;
    }
    const ok = await removeNote(id);
    if (!ok) return;
    /* 删成功才清 id：失败时保留现场，用户还能重试 */
    liveRef.current = { id: null, text: '', saved: '' };
    bumpNotes();
    closeMine();
  };

  const changeOwner = async () => {
    const id = liveRef.current.id;
    if (id == null) return;
    /* 先落盘再换页：改归属会重挂本组件，正文不能丢 */
    const ok = await flush();
    if (!ok) return;
    openSheet({ kind: 'noteItem', noteId: id });
  };

  const owner = note?.itemId == null ? '随记' : itemName(items, note.itemId);

  return (
    <Sheet
      title={noteId == null ? '新便利贴' : '便利贴'}
      onClose={() => void finish()}
      footer={
        <div className="m-sheet__foot-row">
          <button
            type="button"
            className="m-btn m-btn--danger m-btn--small"
            data-armed={armed ? 'true' : 'false'}
            onClick={() => void destroy()}
          >
            {armed ? '再点一次' : '删除'}
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary m-field--grow"
            disabled={loading}
            onClick={() => void finish()}
          >
            完成
          </button>
        </div>
      }
    >
      {error && (
        <p className="m-error" role="alert">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          {error}
        </p>
      )}

      {loading ? (
        <p className="m-empty">正在打开…</p>
      ) : (
        <>
          <button type="button" className="m-note__bind" onClick={() => void changeOwner()}>
            <LinkIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            <span className="m-note__bind-label">归属</span>
            <span className="m-note__bind-value">{owner}</span>
          </button>

          <textarea
            className="m-input m-input--area m-note__area"
            value={text}
            maxLength={NOTE_CONTENT_MAX_LEN}
            placeholder="随手写点什么…"
            onChange={(e) => onChange(e.target.value)}
            aria-label="便利贴正文"
          />

          <p className="m-hint">关掉这一页会自动保存；清空正文再关，等于删除这张。</p>
        </>
      )}
    </Sheet>
  );
}
