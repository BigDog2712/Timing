/**
 * Timing — 新增待办卡「时间能不能写进去」回归测试（V0.3.10）
 * -----------------------------------------------------------------------------
 * 用户报障口径：「待办时间写不进去，待办时间应可空置」。这里把**表单这一层**钉死：
 *   1. 点了日历 → 值真的进了提交参数，且**截止 → plannedAt、开启 → remindAt** 不串位；
 *   2. 两项都不填 → 提交 `(title, null, null)`（可空置，不是「必填但假空」）；
 *   3. 截止早于开启 → 不提交，卡内 inline 报同一句文案。
 * 落库链路（`todosActions.create` → `todo_update` / `todo_create`）在 `todoStore.test.ts`
 * 与后端 `tests/todo.rs` 覆盖，本文件只管卡片。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodosComposeCard } from './TodosComposeCard';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type SubmitFn = (title: string, plannedAt: number | null, remindAt: number | null) => void;

let container: HTMLDivElement;
let root: Root;

async function mount(ui: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** React 的受控 input 只认原型上的 value setter + input 事件 */
async function type(el: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function renderCard() {
  const onSubmit = vi.fn<SubmitFn>();
  const onCancel = vi.fn<() => void>();
  return {
    onSubmit,
    ui: createElement(TodosComposeCard, { busy: false, onSubmit, onCancel }),
  };
}

const fields = (root: HTMLElement) => [...root.querySelectorAll('.dt-field')] as HTMLElement[];
const addButton = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === '添加');

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('TodosComposeCard —— 时间写入', () => {
  it('只填截止时间：提交 (title, plannedAt, null)', async () => {
    const { ui, onSubmit } = renderCard();
    const el = await mount(ui);

    await type(el.querySelector<HTMLInputElement>('input[aria-label="待办名称"]')!, '写周报');
    await click(fields(el)[1]); // 截止时间
    await click(document.querySelector('.dt-pop__day[data-today="true"]'));
    await click(addButton(el));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [title, plannedAt, remindAt] = onSubmit.mock.calls[0];
    expect(title).toBe('写周报');
    expect(typeof plannedAt).toBe('number');
    expect(remindAt).toBeNull();
  });

  it('只填开启时间：提交 (title, null, remindAt)——两项不串位', async () => {
    const { ui, onSubmit } = renderCard();
    const el = await mount(ui);

    await type(el.querySelector<HTMLInputElement>('input[aria-label="待办名称"]')!, '写周报');
    await click(fields(el)[0]); // 开启时间
    await click(document.querySelector('.dt-pop__day[data-today="true"]'));
    await click(addButton(el));

    const [, plannedAt, remindAt] = onSubmit.mock.calls[0];
    expect(plannedAt).toBeNull();
    expect(typeof remindAt).toBe('number');
  });

  it('两项都不填 → (title, null, null)：时间可空置', async () => {
    const { ui, onSubmit } = renderCard();
    const el = await mount(ui);

    await type(el.querySelector<HTMLInputElement>('input[aria-label="待办名称"]')!, '没时间的待办');
    await click(addButton(el));

    expect(onSubmit).toHaveBeenCalledWith('没时间的待办', null, null);
  });

  it('截止早于开启 → 不提交，卡内报同一句文案', async () => {
    const { ui, onSubmit } = renderCard();
    const el = await mount(ui);

    await type(el.querySelector<HTMLInputElement>('input[aria-label="待办名称"]')!, '倒着排');
    /* 截止先落到「上个月」，再让开启取默认的今天 → 必然截止 < 开启 */
    await click(fields(el)[1]);
    await click(document.querySelector('.dt-pop__nav[aria-label="上个月"]'));
    await click(document.querySelector('.dt-pop__day:not([data-out="true"])'));
    await click(fields(el)[0]);
    await click(document.querySelector('.dt-pop__day[data-today="true"]'));

    await click(addButton(el));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('截止时间不能早于开启时间');
  });

  it('「清除」把已选的时间改回空（哪怕先前点过日历）', async () => {
    const { ui, onSubmit } = renderCard();
    const el = await mount(ui);

    await type(el.querySelector<HTMLInputElement>('input[aria-label="待办名称"]')!, '先填再清');
    await click(fields(el)[1]);
    await click(document.querySelector('.dt-pop__day[data-today="true"]'));
    await click(document.querySelector('.dt-pop__clear'));
    await click(addButton(el));

    expect(onSubmit).toHaveBeenCalledWith('先填再清', null, null);
  });
});
