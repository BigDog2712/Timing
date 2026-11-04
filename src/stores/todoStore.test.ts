/**
 * TickBar — todoStore.patch 单测（V0.3.10「行内改时间」）
 * -----------------------------------------------------------------------------
 * 只覆盖这次新增的那条链路（改开启 / 截止时间）：
 *   1. patch 原样透传给 `todo_update`（含 `null` = 清空），成功后以服务端返回行收敛；
 *   2. 只替换目标行，别的待办不受影响；
 *   3. `TODO_NOT_FOUND` → 就地剔除幽灵行（与 rename / toggle 同一口径）；
 *   4. `rename` 仍然只改标题（重构为走 patch 后行为不变）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../types/domain';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('../services/api', () => ({
  todoApi: { update: updateMock },
}));

import { IpcError } from '../services/ipc';
import { useTodoStore } from './todoStore';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function todo(id: number, over: Partial<Todo> = {}): Todo {
  return {
    id,
    title: `待办 ${id}`,
    plannedAt: T0,
    remindAt: T0 - HOUR,
    remindedAt: null,
    doneAt: null,
    sortOrder: id,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  updateMock.mockReset();
  useTodoStore.setState({
    todos: [todo(1), todo(2)],
    loading: false,
    loaded: true,
    error: null,
    pendingDelete: null,
    commitError: null,
  });
});

describe('todoStore.patch', () => {
  it('改截止时间：透传 plannedAt，并只用返回值替换该行', async () => {
    updateMock.mockResolvedValue(todo(1, { plannedAt: T0 + 2 * HOUR }));

    await useTodoStore.getState().patch(1, { plannedAt: T0 + 2 * HOUR });

    expect(updateMock).toHaveBeenCalledWith(1, { plannedAt: T0 + 2 * HOUR });
    const todos = useTodoStore.getState().todos;
    expect(todos.find((t) => t.id === 1)?.plannedAt).toBe(T0 + 2 * HOUR);
    expect(todos.find((t) => t.id === 2)?.plannedAt).toBe(T0);
  });

  it('清空开启时间：null 必须原样进 patch（不是省略字段）', async () => {
    updateMock.mockResolvedValue(todo(1, { remindAt: null }));

    await useTodoStore.getState().patch(1, { remindAt: null });

    expect(updateMock.mock.calls[0][1]).toEqual({ remindAt: null });
    expect(useTodoStore.getState().todos.find((t) => t.id === 1)?.remindAt).toBeNull();
  });

  it('行已不存在（TODO_NOT_FOUND）：就地剔除，不留下幽灵行', async () => {
    updateMock.mockRejectedValue(new IpcError('TODO_NOT_FOUND', '待办不存在'));

    await expect(useTodoStore.getState().patch(1, { plannedAt: null })).rejects.toBeTruthy();
    expect(useTodoStore.getState().todos.map((t) => t.id)).toEqual([2]);
  });

  it('rename 仍只改标题', async () => {
    updateMock.mockResolvedValue(todo(1, { title: '新名字' }));

    await useTodoStore.getState().rename(1, '  新名字  ');

    expect(updateMock.mock.calls[0][1]).toEqual({ title: '新名字' });
    expect(useTodoStore.getState().todos.find((t) => t.id === 1)?.title).toBe('新名字');
  });

  it('空标题仍然在发 IPC 之前就被挡下', async () => {
    await expect(useTodoStore.getState().rename(1, '   ')).rejects.toThrow('待办标题不能为空');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
