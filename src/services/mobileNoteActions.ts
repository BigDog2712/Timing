/**
 * Timing — 移动端便利贴动作（V0.11.0）
 * -----------------------------------------------------------------------------
 * 口径（用户要求「数据落点与桌面端一致」）：**不另建移动侧数据模型**，
 * 直接复用桌面那五条命令 `note_create / note_get / note_list / note_update / note_delete`，
 * 写的是同一个 SQLite 的 `notes` 表。桌面 `plugins/md-sync` 的 `notes` 绑定会照常
 * 把它同步进 Obsidian 那天的 md（宿主每 2 秒轮询一次，移动端不需要额外代码）。
 *
 * 为什么不复用 `stores/noteStore`：那个 store 的语义是「**当前窗口**那一张」
 * （`note-{id}` 单例窗 + 几何去抖 + 关窗前 flush），手机没有多窗也没有几何。
 * 硬套会带进一堆用不上的字段，还会让桌面端为了手机改语义。
 *
 * 几何字段照传桌面默认值（320×232）：手机不消费它们，但桌面首次打开这张便利贴时
 * 需要一个合法尺寸；落点给 0,0，桌面开窗时会按显示器工作区重新钳制。
 */
import { noteApi } from './api';
import { errorText } from './ipc';
import { NOTE_CONTENT_MAX_LEN } from '../types/domain';
import type { Note, NotePatch } from '../types/domain';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

/** 桌面 `note.css` 的默认尺寸，仅作落库占位 */
const DEFAULT_NOTE_W = 320;
const DEFAULT_NOTE_H = 232;

function notify(text: string, tone: 'info' | 'danger' = 'danger'): void {
  useUiStore.getState().setNotice({ text, tone });
}

/** 当前事项：计时中的会话事项优先，空闲取最近事项（与桌面 `noteActions` 同一口径） */
function currentItemId(): number | null {
  const state = useTimerStore.getState().state;
  return state.session?.itemId ?? state.lastItemId ?? null;
}

/** 全部便利贴（按更新时间倒序：最近写的那张在最上面） */
export async function listNotes(itemId?: number): Promise<Note[]> {
  const rows = await noteApi.list(itemId != null ? { itemId } : {});
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 单张（编辑页进入时读；`NOTE_NOT_FOUND` 交给调用方决定退回列表） */
export async function getNote(id: number): Promise<Note | null> {
  try {
    return await noteApi.get(id);
  } catch (err) {
    notify(errorMessage(err));
    return null;
  }
}

/** 新建一张：默认绑定**当前事项**（与桌面 V0.3.9 口径一致），`itemId === null` 才是随记 */
export async function createNote(itemId?: number | null): Promise<Note | null> {
  const bound = itemId === null ? undefined : (itemId ?? currentItemId() ?? undefined);
  try {
    return await noteApi.create({
      itemId: bound,
      content: '',
      posX: 0,
      posY: 0,
      width: DEFAULT_NOTE_W,
      height: DEFAULT_NOTE_H,
    });
  } catch (err) {
    notify(errorMessage(err));
    return null;
  }
}

/** 正文落盘（超长截断，与桌面 noteStore 同一条上限） */
export async function saveNoteContent(id: number, content: string): Promise<Note | null> {
  const clamped = content.length > NOTE_CONTENT_MAX_LEN ? content.slice(0, NOTE_CONTENT_MAX_LEN) : content;
  return patchNote(id, { content: clamped });
}

/** 改归属（`null` = 解绑成随记） */
export async function bindNote(id: number, itemId: number | null): Promise<Note | null> {
  return patchNote(id, { itemId });
}

export async function patchNote(id: number, patch: NotePatch): Promise<Note | null> {
  try {
    return await noteApi.update({ id, patch });
  } catch (err) {
    notify(errorMessage(err));
    return null;
  }
}

/** 删除：正文为空时由调用方决定是否删（空草稿不该留在库里） */
export async function removeNote(id: number): Promise<boolean> {
  try {
    await noteApi.remove(id);
    return true;
  } catch (err) {
    notify(errorMessage(err));
    return false;
  }
}

/** `errorText` 的薄封装：只在本文件用，避免把 services/ipc 的依赖铺到组件里 */
function errorMessage(err: unknown): string {
  return errorText(err);
}

/** 组件侧要显示错误原文时的唯一入口（不直接把 services/ipc 引到 components 层） */
export const noteErrorText = errorText;
