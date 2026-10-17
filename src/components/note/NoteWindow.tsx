/**
 * TickBar — 便利贴窗口根 NoteWindow（label = note-{id}，ADR-009 §1/§2）
 * -----------------------------------------------------------------------------
 * 后端 open_note_window 以 `decorations:false / transparent:true / visible:false`
 * 创建 `note-{id}` 窗口（可缩放、默认置顶）。本组件是该窗根：
 *   1. 依 label 取 note id → 首帧 note_get；
 *   2. **自订阅** theme-changed（主窗不代转，K-21）+ 首帧 theme_get/accent_get；
 *   3. 首帧就绪后自行 show（K-18 防白闪）；
 *   4. Moved/Resized → 逻辑像素去抖落盘（K-15/K-23，见 useNoteGeometry）。
 * V0.2.1 · 3：**零文字**——只剩正文输出框 + 右上角红/黄两枚圆点（删除 / 隐藏）；
 *   原先的标题、页脚（关联事项、说明文字）、删除确认条与置顶按钮全部移除。
 * 背景：未悬停整窗透明（只剩正文浮在桌面上），悬停/聚焦才显影为板（V0.2.1 · 4）。
 */
import { useEffect, useMemo } from 'react';
import { useNoteGeometry } from '../../hooks/useNoteGeometry';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { closeCurrentWindow, currentNoteId, showCurrentWindowOnReady, startCurrentWindowResize } from '../../lib/window';
import { closeNote, removeNote } from '../../services/noteActions';
import { themeActions } from '../../services/themeActions';
import { useNoteStore } from '../../stores/noteStore';
import { useThemeStore } from '../../stores/themeStore';
import { IPC_EVENTS } from '../../types/domain';
import type { ThemeChangedPayload } from '../../types/domain';
import { NoteEditor } from './NoteEditor';
import { NoteHeader } from './NoteHeader';

export function NoteWindow() {
  const noteId = currentNoteId();
  const note = useNoteStore((s) => s.note);
  const error = useNoteStore((s) => s.error);
  const setLocalContent = useNoteStore((s) => s.setLocalContent);
  const saveContent = useNoteStore((s) => s.saveContent);
  const oversize = useNoteGeometry();

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

  const handleHide = async () => {
    if (noteId == null) return void closeCurrentWindow();
    await saveContent();
    await closeNote(noteId);
  };

  const handleDelete = async () => {
    if (noteId == null) return void closeCurrentWindow();
    await removeNote(noteId);
    useNoteStore.getState().clear();
    void closeCurrentWindow();
  };

  /* 标题只剩无障碍用途（屏幕上不显示） */
  const accessibleTitle = useMemo(() => {
    const line = note?.content.split('\n', 1)[0]?.trim() ?? '';
    return line.length > 0 ? `便利贴：${line}` : '便利贴';
  }, [note?.content]);

  /* 首帧就绪后显示窗口（防白闪） */
  useEffect(() => showCurrentWindowOnReady(), []);

  return (
    <div className="note" data-oversize={oversize ? 'true' : 'false'} data-error={error ? 'true' : 'false'}>
      <NoteHeader onRequestHide={() => void handleHide()} onRequestDelete={() => void handleDelete()} />

      <NoteEditor
        value={note?.content ?? ''}
        onChange={setLocalContent}
        onCommit={() => void saveContent()}
        autoFocus={note != null && note.content.length === 0}
        ariaLabel={accessibleTitle}
      />

      {/* [V0.2.4 · 2] 右下角缩放手柄：交给系统做 nwse 缩放，松手后 Moved/Resized 事件照常落盘尺寸 */}
      <div
        className="note__resize"
        role="separator"
        aria-label="拖动调整便利贴大小"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          void startCurrentWindowResize('SouthEast');
        }}
      />
    </div>
  );
}
