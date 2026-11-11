/**
 * G1 手柄卡的五条判据（PRD A-01 / A-02 / A-03 / A-07）
 * -----------------------------------------------------------------------------
 * 为什么值得单开一份：这张卡是 [0.12.1] 唯一的**全新** UI，而它的四条判据全都是「看不见的
 * 结构」——槽位数、选项来源、id 与 label 的分离、关闭态是否真的可编辑。少一条的症状分别是：
 * 「关掉某形态再打开少一行」、「新加的动作选不到」、「改个文案把用户配置洗掉」、
 * 「关了以后再也配不了」。
 *
 * 渲染方式沿用本仓既有口径（没装 `@testing-library/react`）：`createRoot` + `act` 手搓宿主，
 * 断言直接读 DOM。`QuietSelect` 的菜单是 portal 到 `body` 的，所以数选项要在 `document.body` 上数。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_ACTIONS,
  HANDLE_FORM_LABELS,
  HANDLE_SLOTS,
  HANDLE_SLOT_LABELS,
  type HandleFormBinding,
} from '../../../lib/handleCatalog';
import SettingsHandleCard from './SettingsHandleCard';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 挂一张卡；`onChange` 收集调用参数，`onReset` 只记次数。 */
function mount(binding: HandleFormBinding = DEFAULT_HANDLE_BINDINGS.full) {
  const changes: HandleFormBinding[] = [];
  const resets: number[] = [];
  act(() => {
    root.render(createElement(SettingsHandleCard, {
      form: 'full',
      binding,
      onChange: (next: HandleFormBinding) => changes.push(next),
      onReset: () => resets.push(1),
    }));
  });
  return { changes, resets };
}

/** 打开第 `index` 个下拉（portal 到 body），返回菜单里的选项文本。 */
function openSelectOptions(index: number): string[] {
  const triggers = container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  const trigger = triggers[index];
  expect(trigger, `第 ${index + 1} 个下拉不存在`).toBeTruthy();
  act(() => { trigger.click(); });
  return Array.from(document.body.querySelectorAll('[role="option"]'))
    .map((node) => (node.textContent ?? '').trim());
}

describe('G1 手柄卡', () => {
  it('a01_each_form_has_exactly_five_slots', () => {
    /* 槽位恒定 5 个，**顺序必须是字面量**：`left / right / middle / leftDouble / rightDouble`。
       [QA 20261111 修] 原来写的是 `HANDLE_SLOTS.map(...)`——被测组件与期望值读同一份常量，
       把 `HANDLE_SLOTS` 的 leftDouble 与 middle 对调，这条**照样绿**（自证型断言）。
       设计 §13 的「变异 ②：槽位错位 → a01 必红」当时是假的；现在钉字面量才真的会红。 */
    mount();
    const rows = container.querySelectorAll('.settings-handle-card__row');
    expect(rows).toHaveLength(5);
    const labels = Array.from(container.querySelectorAll('.settings-handle-card__label'))
      .map((node) => (node.textContent ?? '').trim());
    expect(labels).toEqual(['左键', '右键', '中键', '左双击', '右双击']);
    /* 常量本身也要守住这个顺序：它是设置卡的行序，也是 5 槽的唯一来源 */
    expect([...HANDLE_SLOTS]).toEqual(['left', 'right', 'middle', 'leftDouble', 'rightDouble']);

    /* 每行都要有一个下拉，且 aria-label 能区分形态与槽位（读屏用户的唯一线索）。
       `QuietSelect` 会在基础 label 后追加当前值（`… : 当前事项便利贴`），所以只钉前缀。 */
    const triggers = container.querySelectorAll('button[aria-haspopup="listbox"]');
    expect(triggers).toHaveLength(5);
    expect(triggers[0].getAttribute('aria-label'))
      .toMatch(new RegExp(`^${HANDLE_FORM_LABELS.full} · ${HANDLE_SLOT_LABELS[HANDLE_SLOTS[0]]}`));
  });

  it('a02_option_count_equals_registry_size_plus_none', () => {
    /* 选项 = 目录 13 条 + 「无」。多一个 = 有第二份清单在漂移；少一个 = 某个动作选不到。 */
    mount();
    const options = openSelectOptions(0);
    expect(options).toHaveLength(HANDLE_ACTIONS.length + 1);
    expect(options[0]).toBe('无');
    expect(options.slice(1)).toEqual(HANDLE_ACTIONS.map((action) => (
      action.irreversible ? `${action.label} · 不可逆` : action.label
    )));
  });

  it('a02_injected_fake_action_appears_in_the_selector', () => {
    /* 扩展点判据：目录里**多一条**，选择器必须立刻多一条（不缓存成模块常量）。
       注入 → 重渲 → 出现；移除 → 重渲 → 消失。两条都不成立就说明选项来自别处。 */
    const fake = { id: 'test.fake', label: '测试动作', group: 'ui' as const };
    HANDLE_ACTIONS.push(fake);
    try {
      mount();
      expect(openSelectOptions(0)).toContain('测试动作');
    } finally {
      const index = HANDLE_ACTIONS.indexOf(fake);
      if (index >= 0) HANDLE_ACTIONS.splice(index, 1);
    }
    /* 移除后重新挂载：同一个下拉里不再有它（证明不是「注入一次就永久记住」）。 */
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(openSelectOptions(0)).not.toContain('测试动作');
  });

  it('a03_renaming_a_label_keeps_the_stored_id', () => {
    /* 持久化的是 id，不是文案：把 `note.current` 的 label 改掉，
       下拉**显示**新文案，而 `slots.left` 仍然是 `note.current`（下一个绑定对象一字不动）。 */
    const target = HANDLE_ACTIONS.find((action) => action.id === 'note.current');
    expect(target, '目录里应有 note.current').toBeTruthy();
    const originalLabel = target!.label;
    target!.label = '改过名的便利贴';
    try {
      mount();
      const trigger = container.querySelector('button[aria-haspopup="listbox"]');
      expect((trigger?.textContent ?? '').trim()).toContain('改过名的便利贴');
      expect(DEFAULT_HANDLE_BINDINGS.full.slots.left).toBe('note.current');
    } finally {
      target!.label = originalLabel;
    }
  });

  it('a07_disabled_handles_are_dimmed_not_disabled', () => {
    /* 关闭态 = 降墨（`data-enabled="false"`），**不是**禁用：控件必须仍然可点可改，
       否则用户没法「先配好再打开」。 */
    const form: HandleFormBinding = { ...DEFAULT_HANDLE_BINDINGS.dot, enabled: false };
    mount(form);
    const card = container.querySelector('.settings-handle-card');
    expect(card?.getAttribute('data-enabled')).toBe('false');
    expect(container.querySelectorAll('[disabled]')).toHaveLength(0);

    /* 关掉之后点一下开关，派发的是「打开」，且绑定内容原样带出去。 */
    const { changes } = mount(form);
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    act(() => { toggle?.click(); });
    expect(changes).toHaveLength(1);
    expect(changes[0].enabled).toBe(true);
    expect(changes[0].slots).toEqual(form.slots);
  });
});
