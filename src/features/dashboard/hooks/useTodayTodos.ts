import { useCallback, useEffect, useRef, useState } from "react";

import {
  createTodo,
  deleteTodo,
  listPendingTodos,
  toggleTodo,
} from "../../../platform/persistence/todoRepository.ts";
import type { TodoSummary } from "../../../shared/types/todos.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/** 撤销窗（与主窗 `todoStore.ts:11` 的 UNDO_WINDOW_MS 同值，语义照抄） */
const UNDO_WINDOW_MS = 3000;

/** 待撤销的那一条 + 它属于哪种操作（`kind` 决定撤销怎么走，见下） */
export type UndoPending =
  | { kind: "delete"; todo: TodoSummary }
  | { kind: "toggle"; todo: TodoSummary };

export interface TodayTodosState {
  todos: TodoSummary[];
  /** `loading` / `ready` / `error` 三态互斥。**没有** `loading: boolean` ——
   *  两个布尔能拼出 `loading && failed` 这种不存在的状态，每个使用点都要记住先判哪个。 */
  status: LoadStatus;
  /** 正在等撤销的那一条；非空时 UI 显示撤销条 */
  pending: UndoPending | null;
  /** 返回 false = 标题为空（UI 不清空输入框） */
  create: (title: string) => Promise<boolean>;
  /** 按 **id** 勾选，`done` 是目标状态（列表里没有一处用下标） */
  toggle: (id: number, done: boolean) => void;
  /** 按 **id** 删除；撤销条需要那一行的快照，由 hook 自己从当前列表取 */
  remove: (id: number) => void;
  undoPending: () => void;
  retry: () => void;
}

/**
 * 今日待办：读 + 三写 + 撤销窗。
 *
 * ## 撤销单槽 + `kind` 分派（不是两个 pending）
 *
 * `todo_delete` 能撤销的前提是"**还没落库**"：本地先移除、3s 内撤销 = 一次都不调后端。
 * `todo_toggle` 是**立即落库**的，撤销 = 反向再调一次 `toggleTodo(id, false)`。
 * 两者"提交"语义不同，但对外只有"最多一条待撤销"（主窗 `todoStore` 同口径），
 * 所以是一个槽 + `kind` 分支，不是两个各自为政的 pending。
 *
 * ## 读失败**不许**伪装成空态
 *
 * `catch` 里落 `status: "error"`，**保留已有行**。写成 `setTodos([])` 的话：
 * 库挂了 → 界面显示「今日无待办」+ 零报错 + 零可见日志，是最坏的一类故障
 * （用户以为自己做完了所有事，其实一条都没读到）。有行 + error = 刷新失败（E3，卡头小图标）；
 * 没行 + error = 模块级错误（E2，卡内一块 + 重试）。
 *
 * 为什么不用 zustand（主窗 `todoStore`）：那是主窗模块，L9 禁止 import；
 * 且这一格的生命周期就是这张卡本身。
 */
export function useTodayTodos(refreshKey: number): TodayTodosState {
  const [todos, setTodos] = useState<TodoSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [pending, setPending] = useState<UndoPending | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingRef = useRef<UndoPending | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const commitPending = useCallback(async () => {
    const target = pendingRef.current;
    if (!target) return;
    clearTimer();
    pendingRef.current = null;
    setPending(null);
    /* toggle 已经落库了，没有"待提交"的东西；撤销走反向调用，见 undoPending */
    if (target.kind !== "delete") return;
    try {
      await deleteTodo(target.todo.id);
    } catch (error: unknown) {
      console.warn("Failed to delete todo:", error);
      /* 回滚：删除没落库，行必须回来（按 sortOrder 归位，别插到末尾） */
      setTodos((current) => [...current, target.todo].sort((left, right) => left.sortOrder - right.sortOrder));
    }
  }, []);

  const reload = useCallback(async () => {
    /* 已有行时不退回 loading：刷新中把列表换成骨架 = 每 30s 闪一次。
       首次加载 / 从错误重试才显示骨架。 */
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    try {
      setTodos(await listPendingTodos());
      setStatus("ready");
    } catch (error: unknown) {
      /* 保留已有行，只翻状态 —— 详见文件头「读失败不许伪装成空态」 */
      console.warn("Failed to load todos:", error);
      setStatus("error");
    }
  }, []);

  /* 前台刷新重拉之前必须先提交未决删除：否则"删了、3s 还没到、后台刷新了一次"会把
   * 那行从库里再拉回来（主窗 todoStore.reload 的第一句就是 commitPending，同一条坑）。 */
  useEffect(() => {
    void (async () => {
      await commitPending();
      await reload();
    })();
  }, [commitPending, reload, refreshKey, attempt]);

  /* 卸载时把未决删除落库：否则"删了但没到 3s 就切视图"会让这一条永远删不掉 */
  useEffect(() => () => { void commitPending(); }, [commitPending]);

  const create = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return false;
    try {
      await createTodo(trimmed);
      await reload();
      return true;
    } catch (error: unknown) {
      /* 返回 false → UI 不清空输入框，用户写的字不丢 */
      console.warn("Failed to create todo:", error);
      return false;
    }
  }, [reload]);

  const armUndo = useCallback((next: UndoPending) => {
    pendingRef.current = next;
    setPending(next);
    clearTimer();
    timerRef.current = window.setTimeout(() => { void commitPending(); }, UNDO_WINDOW_MS);
  }, [commitPending]);

  const toggle = useCallback((id: number, done: boolean) => {
    const target = todos.find((item) => item.id === id);
    if (!target) return;
    void commitPending();
    /* 乐观更新：勾掉 = 从"今天还要做"里移出（`includeDone:false` 的同一结果），
       失败再拉一次真相，避免 UI 与库长期分叉 */
    setTodos((current) => (done
      ? current.filter((item) => item.id !== id)
      : [...current, target].sort((left, right) => left.sortOrder - right.sortOrder)));
    void toggleTodo(id, done).catch((error: unknown) => {
      console.warn("Failed to toggle todo:", error);
      void reload();
    });
    armUndo({ kind: "toggle", todo: target });
  }, [armUndo, commitPending, reload, todos]);

  const remove = useCallback((id: number) => {
    /* 撤销条要显示标题、失败回滚要按 sortOrder 归位 —— 所以先按 id 取一份快照。
       依赖 `todos` 是故意的：闭包里拿到的必须是**当前**这一帧的行。 */
    const target = todos.find((item) => item.id === id);
    if (!target) return;
    void commitPending();
    setTodos((current) => current.filter((item) => item.id !== id));
    armUndo({ kind: "delete", todo: target });
  }, [armUndo, commitPending, todos]);

  const undoPending = useCallback(() => {
    const target = pendingRef.current;
    if (!target) return;
    clearTimer();
    pendingRef.current = null;
    setPending(null);
    if (target.kind === "delete") {
      /* 还没落库，本地恢复即可，一次 IPC 都不发 */
      setTodos((current) => [...current, target.todo].sort((left, right) => left.sortOrder - right.sortOrder));
      return;
    }
    /* toggle 已经落库：撤销 = 反向再调一次 */
    setTodos((current) => [...current, target.todo].sort((left, right) => left.sortOrder - right.sortOrder));
    void toggleTodo(target.todo.id, target.todo.doneAt !== null).catch((error: unknown) => {
      console.warn("Failed to undo toggle:", error);
      void reload();
    });
  }, [reload]);

  const retry = useCallback(() => { setAttempt((current) => current + 1); }, []);

  return { todos, status, pending, create, toggle, remove, undoPending, retry };
}
