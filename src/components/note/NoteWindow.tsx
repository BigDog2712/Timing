/**
 * TickBar — 便利贴窗口根 NoteWindow（label = note-{id}，ADR-009 §1/§2）
 * -----------------------------------------------------------------------------
 * 后端 open_note_window 以 `decorations:false / transparent:true / visible:false`
 * 创建 `note-{id}` 窗口（可缩放、默认置顶）。本组件是该窗根：
 *   1. 依 label 取 note id → 首帧 note_get；
 *   2. **自订阅** theme-changed（主窗不代转，K-21）+ 首帧 theme_get/accent_get；
 *   3. 首帧就绪后自行 show（K-18 防白闪）；
 *   4. Moved/Resized → 逻辑像素去抖落盘（K-15/K-23，见 useNoteGeometry）。
 * 「未悬停全透只剩正文」由 note.css 的 .note:hover / :focus-within 驱动；正文始终可输入。
 * 尺寸/透明底由 html[data-window="note"] 与 .note 承载（见 note.css）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNoteGeometry } from '../../hooks/useNoteGeometry';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { closeCurrentWindow, currentNoteId, setCurrentWindowAlwaysOnTop, showCurrentWindowOnReady } from '../../lib/window';
import { LinkIcon, UnlinkIcon } from '../../lib/icons';
import { closeNote, removeNote } from '../../services/noteActions';
import { themeActions } from '../../services/themeActions';
import { useItemStore } from '../../stores/itemStore';
import { useNoteStore } from '../../stores/noteStore';
import { useThemeStore } from '../../stores/themeStore';
import { IPC_EVENTS } from '../../types/domain';
import type { ThemeChangedPayload } from '../../types/domain';
import { NoteConfirm } from './NoteConfirm';
import { NoteEditor } from './NoteEditor';
import { NoteHeader } from './NoteHeader';

/** 正文首行作为标题（换行折叠为空格语义之外的「窗口标题」用） */
function firstLine(content: string): string {
  const line = content.split('\n', 1)[0]?.trim() ?? '';
  return line;
}

export function NoteWindow() {
  const noteId = currentNoteId();
  const note = useNoteStore((s) => s.note);
  const error = useNoteStore((s) => s.error);
  const setLocalContent = useNoteStore((s) => s.setLocalContent);
  const saveContent = useNoteStore((s) => s.saveContent);
  const setItemId = useNoteStore((s) => s.setItemId);
  const items = useItemStore((s) => s.items);
  const oversize = useNoteGeometry();

  const [pinned, setPinned] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState(false);

  /* ---- 主题：本窗自订阅广播（K-21） ---- */
  useTauriEvent<ThemeChangedPayload>(IPC_EVENTS.themeChanged, (payload) => {
    useThemeStore.getState().apply(payload.mode, payload.accents);
  });

  /* 首帧读权威主题 + 四色 */
  useEffect(() => {
    void themeActions.init().catch(() => useThemeStore.getState().markLoaded());
  }, []);

  /* 首帧：拉当前便利贴（noteId 缺失 → 空窗兜底） */
  useEffect(() => {
    if (noteId == null) return;
    void useNoteStore.getState().load(noteId);
  }, [noteId]);

  /* AC-64 默认置顶：作用于「当前便利贴窗」自身（创建时后端已置顶，此处兜运行期），
     不走主窗 IPC set_always_on_top（那会置顶主窗并污染全局设置） */
  useEffect(() => {
    void setCurrentWindowAlwaysOnTop(true).catch(() => undefined);
  }, []);

  /* 首帧就绪后显示窗口（防白闪） */
  useEffect(() => showCurrentWindowOnReady(), []);

  const title = useMemo(() => (note ? firstLine(note.content) : ''), [note]);
  const untitled = title.length === 0;

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    // 作用于「当前便利贴窗」；失败回滚 UI 态（勿用主窗 IPC）
    void setCurrentWindowAlwaysOnTop(next).catch(() => setPinned(pinned));
  };

  const handleClose = async () => {
    if (noteId == null) return void closeCurrentWindow();
    await saveContent();
    await closeNote(noteId);
  };

  const handleConfirmDelete = async () => {
    if (noteId == null) return;
    await removeNote(noteId);
    useNoteStore.getState().clear();
    void closeCurrentWindow();
  };

  const handleOpenLink = async () => {
    if (items.length === 0) await useItemStore.getState().reload().catch(() => undefined);
    setLinking(true);
  };

  const handlePickItem = async (value: string) => {
    setLinking(false);
    await setItemId(value === '' ? null : Number(value));
  };

  const linked = note?.itemId != null;

  return (
    <div className="note" data-oversize={oversize ? 'true' : 'false'}>
      <NoteHeader
        title={untitled ? '未命名' : title}
        untitled={untitled}
        pinned={pinned}
        onTogglePin={handleTogglePin}
        onRequestDelete={() => setConfirming(true)}
        onRequestClose={() => void handleClose()}
      />

      <NoteEditor
        value={note?.content ?? ''}
        onChange={setLocalContent}
        onCommit={() => void saveContent()}
        autoFocus={note != null && note.content.length === 0}
      />

      {confirming ? (
        <NoteConfirm onCancel={() => setConfirming(false)} onConfirm={() => void handleConfirmDelete()} />
      ) : (
        <footer className="note__foot" data-error={error ? 'true' : 'false'}>
          {error ? (
            <span className="note__foot-text note__foot-error">{error}</span>
          ) : linking ? (
            <select
              className="note__link-select"
              defaultValue=""
              autoFocus
              onBlur={() => setLinking(false)}
              onChange={(e) => void handlePickItem(e.target.value)}
              aria-label="选择要关联的事项"
            >
              <option value="">选择事项…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <span className="note__foot-text">
                {linked ? '第 1 条会同步到记录行 · 换行折叠为空格' : '随记 · 未关联事项'}
              </span>
              <button
                type="button"
                className="note__link"
                onClick={() => (linked ? void setItemId(null) : void handleOpenLink())}
              >
                {linked ? (
                  <>
                    <UnlinkIcon size={16} strokeWidth={2.5} aria-hidden />
                    解绑
                  </>
                ) : (
                  <>
                    <LinkIcon size={16} strokeWidth={2.5} aria-hidden />
                    关联
                  </>
                )}
              </button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
