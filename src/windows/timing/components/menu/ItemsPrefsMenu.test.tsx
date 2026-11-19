/**
 * Timing — 常用事项管理卡 · 多标签与最近事项回归（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 判据钉三件事：
 *   ① **标签落库**：编辑保存时把草稿整组写给 `set_item_tags`；事项名不再冒充分类键。
 *   ② **AI 只填草稿**：建议按下后只改编辑区，仍要用户点保存才落库。
 *   ③ 最近事项回归：toggle 与条数钳位 1..10 的行为拆文件后不变。
 * 落库经 `itemApi` / `settingsApi` / `tagApi`（mock）；AI 走 `aiApi`（mock）。
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
  tagApi: {
    list: vi.fn(async (): Promise<unknown[]> => []),
    set: vi.fn(async (_itemId: number, tags: string[]): Promise<string[]> => tags),
  },
  aiApi: { suggestTags: vi.fn(async (): Promise<unknown> => ({ suggestions: [], stats: { parsed: 0, dropped: 0, attempts: 0 } })) },
}));

vi.mock('../../services/api', () => ({
  itemApi: h.itemApi,
  settingsApi: h.settingsApi,
  tagApi: h.tagApi,
  aiApi: h.aiApi,
  rawIpcText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

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
const tagInput = () => document.body.querySelector<HTMLInputElement>('.items-prefs__tags input');
const tagChips = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.items-prefs__tag-chip'));
const aiButton = () => document.body.querySelector<HTMLButtonElement>('.items-prefs__ai');
const editButton = (name: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').includes(`编辑`) && (button.getAttribute('aria-label') ?? '').includes(name) || button.textContent === name,
  );

async function typeTag(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(tagInput(), text);
    tagInput()?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    tagInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
  h.tagApi.list.mockReset().mockResolvedValue([{ itemId: 7, tags: ['娱乐'] }]);
  h.tagApi.set.mockReset().mockImplementation(async (_itemId: number, tags: string[]) => tags);
  /* 组件读的是 `AiSuggestResponse`（`{suggestions, stats}`），不是裸数组：
     mock 还按旧形状给数组时，`.suggestions[0]` 恒为 undefined，AI 建议这条路
     会"点了没反应"却零报错 —— 这条 mock 的形状本身就是判据的一部分。 */
  h.aiApi.suggestTags.mockReset().mockResolvedValue({
    suggestions: [{ id: 'current', tags: ['娱乐'] }],
    stats: { parsed: 1, dropped: 0, attempts: 1 },
  });
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

describe('常用事项 · 多标签编辑', () => {
  it('ip01_编辑时回填已存标签_保存整组写回', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    expect(tagChips().map((chip) => chip.textContent ?? '').join(' ')).toContain('#娱乐');
    await submit();
    expect(h.tagApi.set).toHaveBeenCalledWith(7, ['娱乐']);
    const patch = h.itemApi.update.mock.calls[0][0].patch as Record<string, unknown>;
    expect('categoryKey' in patch).toBe(false);
  });

  it('ip02_回车添加嵌套标签_本次保存带上', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await typeTag('学习/考公');
    await submit();
    expect(h.tagApi.set).toHaveBeenCalledWith(7, ['娱乐', '学习/考公']);
  });

  it('ip03_点标签移除_保存写空数组', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await act(async () => { tagChips()[0]?.click(); });
    await submit();
    expect(h.tagApi.set).toHaveBeenCalledWith(7, []);
  });

  it('ip04_新建时只带名称_标签另走_set_item_tags', async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(nameInput(), '喝茶');
      nameInput()?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await typeTag('娱乐');
    await submit();
    expect(h.itemApi.create).toHaveBeenCalledWith({ name: '喝茶' });
    expect(h.tagApi.set).toHaveBeenCalledWith(90, ['娱乐']);
  });

  it('ip05_AI_建议只填编辑区_保存才落库', async () => {
    await act(async () => { editButton('写周报')?.click(); });
    await act(async () => { tagChips()[0]?.click(); });
    await act(async () => { aiButton()?.click(); });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(h.aiApi.suggestTags).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'item', targets: [{ id: 'current', text: '写周报' }] }),
    );
    expect(h.tagApi.set).not.toHaveBeenCalled();
    expect(tagChips().map((chip) => chip.textContent ?? '').join(' ')).toContain('#娱乐');
  });

  it('ip08_AI_失败透出宿主原文_不压成通用系统错误', async () => {
    h.aiApi.suggestTags.mockRejectedValueOnce(new Error('AI 未启用：请先在「设置 → AI」打开总开关'));
    await act(async () => { editButton('写周报')?.click(); });
    await act(async () => { aiButton()?.click(); });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(useUiStore.getState().notice?.text).toContain('AI 未启用');
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
