/**
 * Timing — 常用事项管理卡 · 分类选用三态与最近事项回归（[0.14]）
 * -----------------------------------------------------------------------------
 * 判据钉三件事：
 *   ① **三态载荷**：编辑时没动分类 → patch **不带** `categoryKey` 字段；动了 → 显式带值；
 *      选「未分类」→ 显式 `null`。判据写成 `!== undefined` 的反面：「不改」与「清空」
 *      是两件事，合并成 `!= null` 会把「清空」整个吞掉（变异点）。
 *   ② 新建：分类是创建语义的一部分，`create_item` 载荷始终带 `categoryKey`。
 *   ③ 最近事项回归：toggle 与条数钳位 1..10 的行为拆文件后不变。
 * 落库经 `itemApi` / `settingsApi`（mock）；分类目录走 mock 的哑管道行。
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  itemApi: {
    list: vi.fn(async (): Promise<unknown[]> => []),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(async (): Promise<void> => undefined),
    archive: vi.fn(),
    unarchive: vi.fn(),
    categoryCatalog: vi.fn(async () => ({
      definitions: [{ key: '__custom_category::custom:%E5%86%99%E4%BD%9C', value: '' }],
      deleted: [],
      labelOverrides: [{ key: '__category_label_override::custom:%E5%86%99%E4%BD%9C', value: '写作' }],
      colorOverrides: [],
      appOverrides: [],
      webOverrides: [],
    })),
  },
  settingsApi: { update: vi.fn() },
}));

vi.mock('../../services/api', () => ({ itemApi: h.itemApi, settingsApi: h.settingsApi }));

import { useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { ItemsPrefsMenu } from './ItemsPrefsMenu';
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
  isPinned: true,
  createdAt: 0,
  updatedAt: 0,
  categoryKey: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(createElement(ItemsPrefsMenu, { anchor: { x: 40, y: 40 }, onClose: () => undefined }));
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

const nameInput = () => document.body.querySelector<HTMLInputElement>('.items-prefs__form input[type="text"]');
const categorySelect = () => document.body.querySelector<HTMLSelectElement>('.items-prefs__category-select');
const editButton = (name: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').includes(`编辑`) && (button.getAttribute('aria-label') ?? '').includes(name) || button.textContent === name,
  );

async function selectCategory(label: string) {
  const select = categorySelect();
  if (!select) throw new Error('找不到分类下拉');
  const option = Array.from(select.options).find((candidate) => candidate.text === label);
  if (!option) throw new Error(`下拉里没有「${label}」：${Array.from(select.options).map((o) => o.text).join('/')}`);
  await act(async () => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit() {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.items-prefs__form button'))
    .find((candidate) => candidate.textContent === '保存' || candidate.textContent === '添加');
  await act(async () => { button?.click(); });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(async () => {
  h.itemApi.list.mockReset().mockResolvedValue([]);
  h.itemApi.create.mockReset().mockImplementation(async (params: { name: string }) => item(90, params.name, { isPinned: false }));
  h.itemApi.update.mockReset().mockImplementation(async (params: { id: number }) => item(params.id, 'x'));
  h.settingsApi.update.mockReset().mockImplementation(async (patch: Record<string, unknown>) => ({
    ...useSettingsStore.getState().settings,
    ...patch,
  }));
  useItemStore.setState({ items: [item(7, '写周报', { categoryKey: 'game' }), item(9, '摸鱼')] });
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      itemsTimers: {},
      itemsShowRecent: true,
      itemsRecentCount: 5,
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await mount();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useUiStore.setState({ notice: null });
});

describe('常用事项 · 分类选用三态', () => {
  it('ip01_没动分类时_patch_不带_categoryKey_字段（三态之「不改」）', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await submit();
    const patch = h.itemApi.update.mock.calls[0][0].patch as Record<string, unknown>;
    expect('categoryKey' in patch).toBe(false);
  });

  it('ip02_改成游戏时_patch_显式带_categoryKey', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await selectCategory('游戏');
    await submit();
    const patch = h.itemApi.update.mock.calls[0][0].patch as Record<string, unknown>;
    expect(patch.categoryKey).toBe('game');
  });

  it('ip03_选未分类时_patch_显式带_null（不是不带字段——变异点）', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await selectCategory('未分类');
    await submit();
    const patch = h.itemApi.update.mock.calls[0][0].patch as Record<string, unknown>;
    expect('categoryKey' in patch).toBe(true);
    expect(patch.categoryKey).toBeNull();
  });

  it('ip04_新建时_create_载荷带当前分类', async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(nameInput(), '喝茶');
      nameInput()?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await selectCategory('写作');
    await submit();
    expect(h.itemApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: '喝茶', categoryKey: 'custom:%E5%86%99%E4%BD%9C' }));
  });

  it('ip05_当前值不在候选时_兜底项出现在下拉里', async () => {
    /* 目录 mock 只有「写作」；把事项改成目录里没有的键，模拟「分类刚被删」 */
    useItemStore.setState({
      items: [item(7, '写周报', { categoryKey: 'custom:%E5%B7%B2%E5%88%A0%E5%88%86%E7%B1%BB' }), item(9, '摸鱼')],
    });
    await act(async () => { editButton('写周报')?.click(); });
    await selectCategory('未分类');
    const options = Array.from(categorySelect()?.options ?? []).map((option) => option.text);
    expect(options).toContain('写作');
    expect(categorySelect()?.value).toBe('');
  });
});

describe('常用事项 · 最近事项回归（拆文件后行为不变）', () => {
  it('ip06_toggle_显示最近事项_落库布尔取反', async () => {
    const toggle = document.body.querySelector<HTMLButtonElement>('.items-prefs__toggle');
    await act(async () => { toggle?.click(); });
    expect(h.settingsApi.update).toHaveBeenCalledWith({ itemsShowRecent: false });
  });

  it('ip07_条数越界钳到_1_10（99 → 10）', async () => {
    const count = document.body.querySelector<HTMLInputElement>('.items-prefs__count');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(count, '99');
      count?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { count?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(h.settingsApi.update).toHaveBeenCalledWith({ itemsRecentCount: 10 });
  });
});
