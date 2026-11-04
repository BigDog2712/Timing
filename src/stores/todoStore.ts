/**
 * TickBar — 待办 store（V0.2.0 N-2）
 * -----------------------------------------------------------------------------
 * 数据来源：todo_list / todo_create / todo_update / todo_delete / todo_toggle。
 * 口径：事项窗口需按「已完成 / 待办」分组 → 载入 includeDone=true；本地按 sortOrder 升序。
 * 变更命令返回最新 Todo → 就地替换该行（不整表重拉，避免闪烁与排序抖动）。
 * 命令失败即抛 IpcError，由调用方（todosActions / 组件）决定提示与回滚。
 *
 * [AC-32] 删除 =「乐观删除 + 延迟提交」：
 *   点删除 → 本地**立即**移除该行（暂不调后端）+ 记 pendingDelete + 起 UNDO_WINDOW_MS 窗；
 *   窗内撤销 → 恢复本地行、不落库；超时 / 失焦 / 关闭 / 其他待办变更 → commitPending 真正软删；
 *   连续删除多条 → 只保留最后一条待撤销（前一条立即提交）。后端无 todo_restore 命令，故用此法。
 */
import { create } from 'zustand';
import { errorText, IpcError } from '../services/ipc';
import { todoApi } from '../services/api';
import { UNDO_WINDOW_MS } from '../types/domain';
import type { Todo, TodoPatch } from '../types/domain';

/** 一条待撤销的乐观删除（捕获整行以便原样恢复） */
export interface PendingDelete {
  todo: Todo;
  /** 撤销窗口截止时间戳（epoch ms） */
  deadline: number;
}

interface TodoStore {
  todos: Todo[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** 当前待撤销的删除（至多一条；已在本地移除但尚未落库） */
  pendingDelete: PendingDelete | null;
  /** 延迟提交失败提示（删除未落库 → 已回滚本地行） */
  commitError: string | null;
  /** 拉取全部待办（含已完成），按 sortOrder 升序 */
  reload: () => Promise<Todo[]>;
  /** 新建待办（title 去空；空标题抛错） */
  create: (title: string, plannedAt?: number | null, remindAt?: number | null) => Promise<Todo>;
  /** 重命名 */
  rename: (id: number, title: string) => Promise<Todo>;
  /**
   * [V0.3.10] 部分更新（目前用于改开启 / 截止时间）。
   * `plannedAt` / `remindAt` 传 `null` = **显式清空**（后端 `double_option` 落 NULL），
   * 省略字段 = 不动它。
   */
  patch: (id: number, patch: TodoPatch) => Promise<Todo>;
  /** 勾选 / 取消完成（显式传 done，避免盲翻转竞态） */
  toggle: (id: number, done: boolean) => Promise<Todo>;
  /** 乐观删除：本地立即移除 + 起撤销窗（不落库） */
  remove: (id: number) => void;
  /** 撤销未决删除：恢复本地行、清理撤销条（不落库） */
  undoRemove: () => void;
  /** 提交未决删除：真正调 todo_delete；失败回滚本地行并记 commitError */
  commitPending: () => Promise<void>;
  /** 清除延迟提交失败提示 */
  clearCommitError: () => void;
}

/** 排序：sortOrder 升序，同序按 id（与后端 todo_list 同口径） */
function sortTodos(rows: Todo[]): Todo[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** 恢复一行到列表（去重后按序插入） */
function restore(list: Todo[], todo: Todo): Todo[] {
  return list.some((t) => t.id === todo.id) ? list : sortTodos([...list, todo]);
}

/** todo_update / todo_toggle 对已删 id → TODO_NOT_FOUND（后端约定）；命中即就地剔除幽灵行 */
function isNotFound(err: unknown): boolean {
  return err instanceof IpcError && err.code === 'TODO_NOT_FOUND';
}

/** 撤销窗计时器（模块级：不随组件卸载而丢；单窗单实例） */
let pendingTimer: number | null = null;

function clearPendingTimer(): void {
  if (pendingTimer != null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  loaded: false,
  error: null,
  pendingDelete: null,
  commitError: null,

  reload: async () => {
    // 撤销窗内重拉会把未落库的删除行「拉回来」→ 先提交未决删除
    await get().commitPending();
    set({ loading: true, error: null });
    try {
      const rows = await todoApi.list({ includeDone: true });
      const todos = sortTodos(rows);
      set({ todos, loading: false, loaded: true });
      return todos;
    } catch (err) {
      set({ loading: false, loaded: true, error: errorText(err) });
      throw err;
    }
  },

  create: async (title, plannedAt = null, remindAt = null) => {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('待办标题不能为空');
    await get().commitPending();
    const todo = await todoApi.create(trimmed, plannedAt, remindAt);
    set((s) => ({ todos: sortTodos([...s.todos, todo]), commitError: null }));
    return todo;
  },

  rename: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('待办标题不能为空');
    return get().patch(id, { title: trimmed });
  },

  patch: async (id, patch) => {
    await get().commitPending();
    try {
      const todo = await todoApi.update(id, patch);
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? todo : t)), commitError: null }));
      return todo;
    } catch (err) {
      if (isNotFound(err)) set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
      throw err;
    }
  },

  toggle: async (id, done) => {
    await get().commitPending();
    try {
      const todo = await todoApi.toggle(id, done);
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? todo : t)), commitError: null }));
      return todo;
    } catch (err) {
      if (isNotFound(err)) set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
      throw err;
    }
  },

  remove: (id) => {
    const todo = get().todos.find((t) => t.id === id);
    if (!todo) return;
    // 连续删除：前一条未决删除立即提交（撤销条只保留最后一条）
    void get().commitPending();
    clearPendingTimer();
    set((s) => ({
      todos: s.todos.filter((t) => t.id !== id),
      pendingDelete: { todo, deadline: Date.now() + UNDO_WINDOW_MS },
      commitError: null,
    }));
    pendingTimer = window.setTimeout(() => {
      void get().commitPending();
    }, UNDO_WINDOW_MS);
  },

  undoRemove: () => {
    const pending = get().pendingDelete;
    if (!pending) return;
    clearPendingTimer();
    set((s) => ({ pendingDelete: null, todos: restore(s.todos, pending.todo) }));
  },

  commitPending: async () => {
    const pending = get().pendingDelete;
    if (!pending) return;
    clearPendingTimer();
    set({ pendingDelete: null });
    try {
      await todoApi.remove(pending.todo.id);
    } catch (err) {
      set((s) => ({
        todos: restore(s.todos, pending.todo),
        commitError: `删除「${pending.todo.title}」未保存：${errorText(err)}`,
      }));
    }
  },

  clearCommitError: () => set({ commitError: null }),
}));
