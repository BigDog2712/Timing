/**
 * TickBar — 便利贴 store（V0.2.0 N-4 · 单窗单实例：label = note-{id}）
 * -----------------------------------------------------------------------------
 * 数据来源：note_get / note_update / note_delete（Rust 命令）。
 * 口径：
 *   - 每张便利贴一个独立 WebviewWindow，本 store 只承载**当前窗**那一行（ADR-009）。
 *   - **正文**：本地即时改（setLocalContent）→ 失焦 / Ctrl+Enter 落盘（saveContent）。
 *     「无变化」判断以 `savedContent`（最近一次落盘值）为基准——**不可**与本地即时值比较，
 *     否则本地值恒等于自身会导致落盘被静默跳过。
 *   - **几何 / 关联**：拖拽移动 / 缩放 → patchGeom 合并去抖 NOTE_GEOM_DEBOUNCE_MS
 *     （K-23）→ note_update。关窗几何由后端 close_note_window 从活窗口自读落盘（后端口径）。
 *   - 保存失败 → error 文案（页脚临时换 --danger），内容保留不丢。
 */
import { create } from 'zustand';
import { errorText } from '../services/ipc';
import { noteApi } from '../services/api';
import { NOTE_CONTENT_MAX_LEN, NOTE_GEOM_DEBOUNCE_MS } from '../types/domain';
import type { Note, NotePatch } from '../types/domain';

/** 合并后的未决几何变更（去抖窗口内累积） */
let geomTimer: number | null = null;
let pendingGeom: NotePatch | null = null;

function clearGeomTimer(): void {
  if (geomTimer != null) {
    window.clearTimeout(geomTimer);
    geomTimer = null;
  }
}

interface NoteStore {
  note: Note | null;
  /** 最近一次**落盘**的正文（note.content 为本地即时值；二者比对判定「无变化」） */
  savedContent: string;
  loading: boolean;
  loaded: boolean;
  saving: boolean;
  /** 保存失败提示（页脚临时文案） */
  error: string | null;
  /** 拉取当前便利贴（note_get） */
  load: (id: number) => Promise<Note | null>;
  /** 正文本地即时改（不落库） */
  setLocalContent: (content: string) => void;
  /** 正文落盘（超长截断）；content 省略 = 用当前本地值 */
  saveContent: (content?: string) => Promise<void>;
  /** 几何 / 关联变更：合并去抖后落盘（K-23） */
  patchGeom: (patch: NotePatch) => void;
  /** 关联 / 解绑事项（AC-63；即时落盘，itemId=null 解绑为随记） */
  setItemId: (itemId: number | null) => Promise<void>;
  /** 切换置顶（AC-64；即时落盘，后端同步窗口层级） */
  setPinned: (pinned: boolean) => Promise<void>;
  /** 立即落盘未决几何变更（关窗前） */
  flush: () => Promise<void>;
  /** 本窗便利贴被删除 → 清空本地 */
  clear: () => void;
  clearError: () => void;
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  note: null,
  savedContent: '',
  loading: false,
  loaded: false,
  saving: false,
  error: null,

  load: async (id) => {
    set({ loading: true, error: null });
    try {
      const note = await noteApi.get(id);
      set({ note, savedContent: note.content, loading: false, loaded: true });
      return note;
    } catch (err) {
      // NOTE_NOT_FOUND（已被删除）时不阻塞渲染，交由调用方决定关闭
      set({ loading: false, loaded: true, error: errorText(err) });
      return null;
    }
  },

  setLocalContent: (content) => {
    const current = get().note;
    if (!current) return;
    set({ note: { ...current, content } });
  },

  saveContent: async (content) => {
    const current = get().note;
    if (!current) return;
    const raw = content ?? current.content;
    const clamped = raw.length > NOTE_CONTENT_MAX_LEN ? raw.slice(0, NOTE_CONTENT_MAX_LEN) : raw;
    if (clamped === get().savedContent) {
      /* 与最近落盘值一致：不产生多余 IPC */
      return;
    }
    set({ saving: true, error: null });
    try {
      const note = await noteApi.update({ id: current.id, patch: { content: clamped } });
      set({ note, savedContent: note.content, saving: false });
    } catch (err) {
      set({ saving: false, error: errorText(err) });
    }
  },

  patchGeom: (patch) => {
    const current = get().note;
    if (!current) return;
    pendingGeom = { ...(pendingGeom ?? {}), ...patch };
    clearGeomTimer();
    geomTimer = window.setTimeout(() => {
      geomTimer = null;
      void get().flush();
    }, NOTE_GEOM_DEBOUNCE_MS);
  },

  flush: async () => {
    clearGeomTimer();
    const patch = pendingGeom;
    pendingGeom = null;
    const current = get().note;
    if (!patch || !current) return;
    try {
      const note = await noteApi.update({ id: current.id, patch });
      set({ note, savedContent: note.content, error: null });
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  setItemId: async (itemId) => {
    const current = get().note;
    if (!current) return;
    // 关联与几何共用一个 note_update；先把未决几何并入，避免覆盖丢失（K-23 合并语义）
    const merged: NotePatch = { ...(pendingGeom ?? {}), itemId };
    clearGeomTimer();
    pendingGeom = null;
    try {
      const note = await noteApi.update({ id: current.id, patch: merged });
      set({ note, savedContent: note.content, error: null });
    } catch (err) {
      set({ error: errorText(err) });
    }
  },

  setPinned: async (pinned) => {
    const current = get().note;
    if (!current) return;
    /* 乐观翻转：置顶是「点了就要看见」的开关，等 IPC 往返会有一拍迟滞。
       失败时回滚成落库前的值，避免「看着置顶、其实没落库」的假象。 */
    set({ note: { ...current, isPinned: pinned } });
    const merged: NotePatch = { ...(pendingGeom ?? {}), isPinned: pinned };
    clearGeomTimer();
    pendingGeom = null;
    try {
      const note = await noteApi.update({ id: current.id, patch: merged });
      set({ note, savedContent: note.content, error: null });
    } catch (err) {
      set({ note: current, error: errorText(err) });
    }
  },

  clear: () => set({ note: null, savedContent: '', loaded: true, error: null }),
  clearError: () => set({ error: null }),
}));
