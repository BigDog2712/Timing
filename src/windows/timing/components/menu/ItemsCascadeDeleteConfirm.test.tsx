/**
 * Timing — 级联删除确认弹窗 ItemsCascadeDeleteConfirm 判据（[0.14]）
 * -----------------------------------------------------------------------------
 * 后端 `delete_item` 已升级为级联软删（同事务删父 + 全部直接子）。前端判据钉三件：
 *   ① 确认文案把级联说清：「将同时移除其 N 个子事项」+ 子事项逐条列出（N 动态）；
 *   ② 确认 → `itemApi.remove` 一次（级联在后端事务里，前端不做第二次调用）+ reload；
 *   ③ 取消 / 点 scrim → 不调 remove。
 * 无子事项不弹框（保持两步 arm）的分流在 `ItemMenu`，由 `childCount > 0` 判据承担。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  remove: vi.fn(async (): Promise<void> => undefined),
  list: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('../../services/api', () => ({
  itemApi: {
    remove: h.remove,
    list: h.list,
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    categoryCatalog: vi.fn(async () => ({
      definitions: [], deleted: [], labelOverrides: [], colorOverrides: [], appOverrides: [], webOverrides: [],
    })),
  },
  settingsApi: { update: vi.fn() },
}));

import { useUiStore } from '../../stores/uiStore';
import { ItemsCascadeDeleteConfirm } from './ItemsCascadeDeleteConfirm';
import type { Item } from '../../types/domain';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: number, name: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  color: null,
  status: 'active',
  isSystem: false,
  sortOrder: id,
  remindAt: null,
  remindedAt: null,
  isPinned: false,
  createdAt: 0,
  updatedAt: 0,
  categoryKey: null,
  ...over,
});

const PARENT = item(7, '学习 SQL');
const CHILD_A = item(8, 'chrome', { parentId: 7 });
const CHILD_B = item(9, 'yysls', { parentId: 7 });
const UNRELATED = item(10, '别的事');

let container: HTMLDivElement;
let root: Root;
let onClose: () => void;

async function mount(items: Item[]) {
  await act(async () => {
    root.render(createElement(ItemsCascadeDeleteConfirm, {
      item: items.find((candidate) => candidate.id === 7) ?? PARENT,
      items,
      onClose,
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  h.remove.mockClear();
  h.list.mockReset().mockResolvedValue([]);
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useUiStore.setState({ notice: null });
});

describe('级联删除确认弹窗', () => {
  it('cd01_文案逐字含「将同时移除其 N 个子事项」且逐条列出子事项', async () => {
    await mount([PARENT, CHILD_A, CHILD_B, UNRELATED]);
    const text = document.body.textContent ?? '';
    expect(text).toContain('将同时移除其 2 个子事项');
    expect(text).toContain('chrome');
    expect(text).toContain('yysls');
    expect(text).not.toContain('别的事');
  });

  it('cd02_确认后调一次_remove_并刷新事项表', async () => {
    await mount([PARENT, CHILD_A, CHILD_B]);
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('删除'));
    await act(async () => { confirm?.click(); });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith({ id: 7 });
    expect(h.list).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('cd03_取消不调_remove', async () => {
    await mount([PARENT, CHILD_A, CHILD_B]);
    const cancel = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === '取消');
    await act(async () => { cancel?.click(); });
    expect(h.remove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
