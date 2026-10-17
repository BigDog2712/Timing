/**
 * TickBar — 便利贴动作（菜单 / 事项右键 / 托盘 共用；唯一创建·开关窗口径）
 * -----------------------------------------------------------------------------
 * 依据 ADR-009 §7「职责分离」：note_create **只建数据行**，窗口由 open_note_window 负责。
 *   - openNoteForItem(itemId)：先建行（带 itemId）再开窗（AC-63 关联）。
 *   - openNewNote()：随记（item_id = null），页脚提供「关联事项…」入口。
 *   - openNoteWindowFor(id)：仅开已有行的窗（note-window-opened 恢复 / 右键「便利贴…」）。
 *   - closeNote(noteId)：先落盘未决正文，再关闭后端窗（几何由后端自读，前端不传）。
 *   - removeNote(noteId)：note_delete + 关窗（内联确认条「确认删除」）。
 * 非 Tauri（浏览器 dev 无多窗口）→ 提示条兜底（与 todosActions 同口径）。
 */
import { errorText, ipc, isTauri } from './ipc';
import { useNoteStore } from '../stores/noteStore';
import { useUiStore } from '../stores/uiStore';
import { NOTE_MIN_H, NOTE_MIN_W } from '../types/domain';
import type { Note } from '../types/domain';

/** 便利贴默认几何（逻辑像素）：--note-w 320 × --note-h 232（sticky-note.md §1） */
const DEFAULT_NOTE_W = 320;
const DEFAULT_NOTE_H = 232;
/** 逐张错位偏移，避免新便利贴完全重叠 */
const CASCADE_STEP = 28;

function notify(text: string, tone: 'info' | 'danger' = 'danger'): void {
  useUiStore.getState().setNotice({ text, tone });
}

/** 计算下一张便利贴的落点（取现有数量做层叠偏移；清单不可用则退回起点） */
async function nextPlacement(): Promise<{ posX: number; posY: number }> {
  let count = 0;
  try {
    count = (await ipc.noteList({})).length;
  } catch {
    /* 清单不可用：用固定起点 */
  }
  const step = (count % 8) * CASCADE_STEP;
  return { posX: 120 + step, posY: 120 + step };
}

/** 仅打开已有便利贴的窗口（后端单例按 label 去重：已开则 show+focus） */
export async function openNoteWindowFor(noteId: number): Promise<void> {
  if (isTauri()) {
    try {
      await ipc.openNoteWindow({ noteId });
      return;
    } catch (err) {
      notify(errorText(err));
      return;
    }
  }
  useUiStore.getState().setNotice({ text: '便利贴需在桌面版中打开', tone: 'info' });
}

/** 新建便利贴：建行（可挂事项）→ 开窗；超 20 张由后端返回 WINDOW_LIMIT_EXCEEDED */
export async function openNewNote(itemId?: number | null): Promise<Note | null> {
  const { posX, posY } = await nextPlacement();
  try {
    const note = await ipc.noteCreate({
      itemId: itemId ?? undefined,
      content: '',
      posX,
      posY,
      width: DEFAULT_NOTE_W,
      height: DEFAULT_NOTE_H,
    });
    try {
      await ipc.openNoteWindow({ noteId: note.id });
    } catch (err) {
      // 建行成功但窗口创建失败时回滚，避免留下不可见空白贴。
      try {
        await ipc.noteDelete({ id: note.id });
      } catch {
        /* 保留原始打开失败提示；后端清理失败由下一次清理处理 */
      }
      notify(errorText(err));
      return null;
    }
    return note;
  } catch (err) {
    notify(errorText(err));
    return null;
  }
}

/** 从事项右键 / 事项窗口进入：为某事项新建便利贴（itemId 关联，AC-63） */
export function openNoteForItem(itemId: number): Promise<Note | null> {
  return openNewNote(itemId);
}

/** 便利贴清单（便利贴清单浮层用）：省略 itemId = 全部 */
export function listNotes(itemId?: number): Promise<Note[]> {
  return ipc.noteList(itemId != null ? { itemId } : {});
}

/** [V0.2.1] 手柄左键：唤出**当前事项的便利贴**——已有则开那张（取最近更新时间），否则新建一张 */
export async function openOrCreateNoteForItem(itemId: number | null): Promise<Note | null> {
  let notes: Note[];
  try {
    notes = await listNotes(itemId ?? undefined);
  } catch (err) {
    notify(errorText(err));
    return null;
  }
  const latest = notes
    .filter((note) => (note.itemId ?? null) === itemId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) {
    await openNoteWindowFor(latest.id);
    return latest;
  }
  return openNewNote(itemId);
}

/** 关闭便利贴窗口（「收纳」）：先落盘未决正文，再关后端窗。
 *  几何由后端 close_note_window 从活窗口自读并落盘（后端口径），前端**不传几何**。 */
export async function closeNote(noteId: number): Promise<void> {
  const store = useNoteStore.getState();
  const current = store.note;
  // 空白草稿取消时删除数据行，避免「取消新建」留下不可见便利贴。
  if (current && current.id === noteId && current.content.trim().length === 0) {
    await removeNote(noteId);
    return;
  }
  // 提交未决正文（与最近落盘值一致时 store 内部自动跳过，幂等）
  await store.saveContent().catch(() => undefined);
  if (isTauri()) {
    try {
      await ipc.closeNoteWindow({ noteId });
    } catch (err) {
      notify(errorText(err));
    }
  }
}

/** 删除便利贴（内联确认条「确认删除」）：note_delete + 关窗 */
export async function removeNote(noteId: number): Promise<void> {
  try {
    await ipc.noteDelete({ id: noteId });
  } catch (err) {
    notify(errorText(err));
    return;
  }
  if (isTauri()) {
    try {
      await ipc.closeNoteWindow({ noteId });
    } catch {
      /* 窗口已关闭（或不存在）不阻断删除结果 */
    }
  }
}

/** 便利贴尺寸硬钳制（对齐 domain 常量；窗口侧另有 work_area 收窄） */
export const NOTE_SIZE_LIMITS = { minW: NOTE_MIN_W, minH: NOTE_MIN_H } as const;
