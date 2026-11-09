/**
 * Timing — 移动端便利贴页（V0.11.0 · Tab ④）
 * -----------------------------------------------------------------------------
 * 用户要求：「补齐手机端便利贴功能，数据落点与桌面端一致」。
 * 落点是同一张 `notes` 表（`mobileNoteActions` 直接走桌面那五条 note 命令），
 * 所以手机上写的内容回到电脑打开就是同一张；桌面 `md-sync` 插件的 `notes` 绑定
 * 会把它写进 Obsidian 那天的 md（手机端不需要为同步写任何代码）。
 *
 * 两段：
 *   ① 新建区 —— 一键建一张，**默认绑定当前事项**（与桌面 V0.3.9 口径一致），
 *      建完直接进编辑页，不让人对着空列表发呆；
 *   ② 列表 —— 按更新时间倒序，每行两行文本 + 归属事项。点行 = 看整张（只读面板，
 *      [V0.11.32] 起不是直接进编辑页：列表两行封顶，长正文在编辑框里也只能滚着看开头），
 *      行尾垃圾桶 / 长按 = 删除确认。
 *      **全部便利贴都在这**（`note_list` 不带日期过滤），往期的一直能看能删——[V0.11.30]
 *      补了行尾那个看得见的删除键：长按删除是隐形手势，主人找不到就等于没有。
 *
 * 为什么长按删除而不是行内放垃圾桶：手机上一行只有 3.5 个字的横向余量，
 * 常驻删除键会被拇指误触；长按 + 编辑页里的显式删除两个入口够用。
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLongPress } from '../../hooks/useLongPress';
import { formatClockTime } from '../../lib/format';
import { AlertIcon, PlusIcon, StickyNoteIcon, TrashIcon, iconStroke } from '../../lib/icons';
import { listNotes, noteErrorText, removeNote } from '../../services/mobileNoteActions';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import type { Note } from '../../types/domain';

interface NoteRowProps {
  note: Note;
  owner: string;
  pending: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

function NoteRow({ note, owner, pending, onOpen, onDelete }: NoteRowProps) {
  /* [V0.11.32] 点按改成正经的 `onClick`（长按仍归 `useLongPress`）。
     上一版把点按挂在 `pointerup` 上：能跑，但「点一下打开」是列表最常用的动作，
     押在一条手写的指针分支上不值得——WebView 上 pointerup 被父级滚动抢走的版本差异
     真实存在，而 `onClick` 是浏览器保证的。长按之后紧跟的那次 click 用 `longPressed`
     挡掉，否则「长按删除」会顺手再打开这张便利贴的全文。 */
  const longPressed = useRef(false);
  const press = useLongPress(() => {
    longPressed.current = true;
    onDelete();
  });
  const text = note.content.trim();
  return (
    <li>
      <div
        className="m-note"
        data-pending={pending ? 'true' : 'false'}
        {...press}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onOpen();
        }}
      >
        <p className="m-note__text" data-empty={text.length === 0 ? 'true' : 'false'}>
          {text.length === 0 ? '空白便利贴' : text}
        </p>
        <p className="m-note__meta">
          <span className="m-note__owner">{owner}</span>
          <span className="m-note__time">{formatClockTime(note.updatedAt)}</span>
        </p>
        {/* [V0.11.30] 显式删除键：长按删除一直存在，但**看不见就等于没有**（主人反馈
            「便利贴无任何交互」）。按钮自己吞掉 pointerdown，免得外层长按计时器同时启动。 */}
        <button
          type="button"
          className="m-note__del"
          aria-label="删除这张便利贴"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      </div>
    </li>
  );
}

export function NotesPage() {
  const items = useItemStore((s) => s.items);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  /* [V0.11.2] 编辑 Sheet 是覆盖层，本页始终挂载 → 写完 / 改完 / 删完由信号触发重拉，
     否则新写的便利贴要等切页才出现，改过的内容还显示旧文本。 */
  const notesNonce = useMobileUiStore((s) => s.notesNonce);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* 删除是长按触发的危险操作，先记下待删的那条，等第二次点击确认 */
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNotes(await listNotes());
    } catch (err) {
      setError(noteErrorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, notesNonce]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await removeNote(pendingDelete.id);
    setPendingDelete(null);
    if (ok) await reload();
  };

  return (
    <div className="m-notes">
      <section className="m-section">
        <header className="m-section__head">
          <h2 className="m-section__title">全部便利贴</h2>
          <span className="m-section__meta">{loading ? '…' : `${notes.length} 张`}</span>
        </header>

        <button
          type="button"
          className="m-btn m-btn--primary m-note__new"
          onClick={() => {
            /* `noteId: null` = 新建：由编辑页建行并立即进入书写态（不在这里建完再跳，
               否则建完就关掉会留下一张永远空白的行） */
            openSheet({ kind: 'noteEdit', noteId: null });
          }}
        >
          <PlusIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          写一张新的
        </button>
        <p className="m-hint m-note__tip">
          <StickyNoteIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          默认挂到当前事项；在编辑页可以改归属或解绑。
        </p>

        {error && (
          <p className="m-error" role="alert">
            <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            {error}
          </p>
        )}

        {loading ? (
          <p className="m-empty">正在读取…</p>
        ) : notes.length === 0 ? (
          <p className="m-empty">还没有便利贴。点上面的按钮写第一张。</p>
        ) : (
          <ul className="m-list m-list--note">
            {notes.map((note) => (
              <Fragment key={note.id}>
                <NoteRow
                  note={note}
                  owner={note.itemId == null ? '随记' : itemName(items, note.itemId)}
                  pending={pendingDelete?.id === note.id}
                  onOpen={() => openSheet({ kind: 'noteView', noteId: note.id })}
                  onDelete={() => setPendingDelete(note)}
                />
                {/* [V0.11.2] 确认条贴着被删那行展开：原先固定渲染在列表上方，
                    列表一长，用户在下方长按时屏幕上毫无变化，以为功能坏了。 */}
                {pendingDelete?.id === note.id && (
                  <li className="m-confirm-wrap">
                    <div className="m-confirm" role="alertdialog" aria-label="确认删除便利贴">
                      <p className="m-confirm__text">删除这张便利贴？此操作不可撤销。</p>
                      <div className="m-confirm__actions">
                        <button
                          type="button"
                          className="m-btn m-btn--small"
                          onClick={() => setPendingDelete(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="m-btn m-btn--small m-btn--danger"
                          onClick={() => void confirmDelete()}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
