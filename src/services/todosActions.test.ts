/**
 * TickBar — 待办时间「写入 / 清空」的端到端单测（V0.3.10）
 * -----------------------------------------------------------------------------
 * 这一层不 mock 任何东西：`todosActions` → `todoStore` → `services/api` → `ipc` → 浏览器 mock
 * （`browserMockV020` 的 `todo_create` / `todo_update`，与后端 `services::todo` 同语义）。
 * 目的正是用户那句「待办时间写不进去」的反面证据：**两项时间都得进得去、读得回、清得掉**。
 * 后端 SQL 口径另由 `src-tauri/src/tests/todo.rs` 覆盖。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { todosActions } from './todosActions';
import { useTodoStore } from '../stores/todoStore';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

beforeEach(async () => {
  await useTodoStore.getState().reload();
});

describe('待办时间端到端', () => {
  it('新建：开启 / 截止各进各的字段，读回一致', async () => {
    const todo = await todosActions.create('写周报', T0, T0 - HOUR);
    expect(todo.plannedAt).toBe(T0);
    expect(todo.remindAt).toBe(T0 - HOUR);

    const rows = await todosActions.reload();
    expect(rows.find((t) => t.id === todo.id)).toMatchObject({ plannedAt: T0, remindAt: T0 - HOUR });
  });

  it('新建时两项都可空置', async () => {
    const todo = await todosActions.create('没时间的待办');
    expect(todo.plannedAt).toBeNull();
    expect(todo.remindAt).toBeNull();
  });

  it('事后改时间：patch 后重拉仍是新值', async () => {
    const todo = await todosActions.create('改时间');
    await todosActions.patch(todo.id, { plannedAt: T0, remindAt: T0 - HOUR });

    const row = (await todosActions.reload()).find((t) => t.id === todo.id);
    expect(row?.plannedAt).toBe(T0);
    expect(row?.remindAt).toBe(T0 - HOUR);
  });

  it('事后清空：null 真的落成 null（不是被忽略）', async () => {
    const todo = await todosActions.create('先填再清', T0, T0 - HOUR);
    await todosActions.patch(todo.id, { plannedAt: null, remindAt: null });

    const row = (await todosActions.reload()).find((t) => t.id === todo.id);
    expect(row?.plannedAt).toBeNull();
    expect(row?.remindAt).toBeNull();
  });
});
