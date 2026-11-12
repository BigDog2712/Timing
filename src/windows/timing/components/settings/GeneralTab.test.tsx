/**
 * `GeneralTab` —— 「最短记录时长」数字输入框（V0.3.5：滑杆改手动输入，ADR-023）。
 *
 * 这一行是**唯一**能改阈值的入口，四件事都得对：
 *   1. 数字：范围 5–300、整数、默认 30（参考设置未就绪时用兜底值）；
 *   2. 提交时机：失焦或回车，输入过程中的半成品不写库；
 *   3. 写库那一跳：`update_reference_settings` 是 patch 语义，Rust 侧
 *      `ReferenceSettingsPatch` 按字段名匹配（camelCase + 全 Option）——
 *      **字段名写错不会报错，只是什么都不写**，表现成「改完下次打开又回 30」；
 *   4. 非法输入（空 / 非数字）回退原值，越界钳到 5 / 300。
 *
 * 渲染走真实 DOM（`createRoot` + `act`）：zustand v5 在 `renderToStaticMarkup` 下读的是
 * 初始 state，SSR 断言在这个项目里不可用。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_DEFAULTS } from '../../mocks/mockSeed';
import { ipc } from '../../services/ipc';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ReferenceSettings } from '../../types/domain';
import { GeneralTab } from './GeneralTab';

/* React 19 的 act() 需要这个全局标记，否则每次 act 都会打一条 deprecation 警告 */
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(GeneralTab));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

const numberInput = (el: HTMLElement): HTMLInputElement => {
  const found = el.querySelector<HTMLInputElement>('input[type="number"]');
  if (!found) throw new Error('没有渲染出数字输入框');
  return found;
};

/** 改值并派发 input 事件（React 的 onChange 走 input） */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 失焦：React 的 onBlur 走 focusout 委托 */
async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('GeneralTab —— 最短记录时长', () => {
  beforeEach(() => {
    useSettingsStore.setState({ referenceSettings: null, loaded: false });
    vi.spyOn(ipc, 'getReferenceSettings').mockResolvedValue({ ...REFERENCE_DEFAULTS });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    vi.restoreAllMocks();
  });

  it('范围与默认值：5–300、整数步进，未加载完成时兜底 30，单位为 S', async () => {
    const el = await mount();
    const input = numberInput(el);

    expect(input.min).toBe('5');
    expect(input.max).toBe('300');
    expect(input.step).toBe('1');
    expect(input.value, '参考设置未就绪时按后端出厂值 30 显示').toBe('30');
    /* 单位是大写 S（用户口径「30S」），input 的值不在 textContent 里，故单查单位节点 */
    expect(el.querySelector('.num-field__unit')?.textContent).toBe('S');
    expect(el.textContent, '说明文字已删，只留数字 + 单位').not.toContain('低于此时长不记录');
  });

  it('读到的设置值直接反映在输入框上', async () => {
    useSettingsStore.setState({
      referenceSettings: { ...REFERENCE_DEFAULTS, minRecordSeconds: 90 },
    });
    const el = await mount();

    expect(numberInput(el).value).toBe('90');
    expect(el.querySelector('.num-field__unit')?.textContent).toBe('S');
  });

  it('手动输入按 patch 语义写库：{ patch: { minRecordSeconds } }（不按 5 的整数倍）', async () => {
    const update = vi
      .spyOn(ipc, 'updateReferenceSettings')
      .mockImplementation(async ({ patch }) => ({ ...REFERENCE_DEFAULTS, ...patch }) as ReferenceSettings);

    const el = await mount();
    const input = numberInput(el);
    await type(input, '47');
    expect(update, '输入过程中不该写库').not.toHaveBeenCalled();

    await blur(input);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ patch: { minRecordSeconds: 47 } });
    expect(useSettingsStore.getState().referenceSettings?.minRecordSeconds).toBe(47);
  });

  it('回车即提交，不必先点别处', async () => {
    const update = vi
      .spyOn(ipc, 'updateReferenceSettings')
      .mockImplementation(async ({ patch }) => ({ ...REFERENCE_DEFAULTS, ...patch }) as ReferenceSettings);

    const el = await mount();
    const input = numberInput(el);
    await type(input, '60');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith({ patch: { minRecordSeconds: 60 } });
  });

  it('越界钳到 5 / 300，其余值原样保存', async () => {
    const update = vi
      .spyOn(ipc, 'updateReferenceSettings')
      .mockImplementation(async ({ patch }) => ({ ...REFERENCE_DEFAULTS, ...patch }) as ReferenceSettings);

    const el = await mount();
    const input = numberInput(el);

    await type(input, '999');
    await blur(input);
    expect(update).toHaveBeenLastCalledWith({ patch: { minRecordSeconds: 300 } });

    await type(input, '1');
    await blur(input);
    expect(update).toHaveBeenLastCalledWith({ patch: { minRecordSeconds: 5 } });
  });

  it('清空或非数字失焦后回退原值，不写库', async () => {
    const update = vi.spyOn(ipc, 'updateReferenceSettings');

    const el = await mount();
    const input = numberInput(el);

    await type(input, '');
    await blur(input);
    expect(update).not.toHaveBeenCalled();
    expect(input.value).toBe('30');
  });
});
