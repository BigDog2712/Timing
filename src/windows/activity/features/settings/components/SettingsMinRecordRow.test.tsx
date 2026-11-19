/**
 * `SettingsMinRecordRow`（「最短记录时长」这一行）—— [B5d] 从 `HostGeneralPanel` 搬迁后补测
 * -----------------------------------------------------------------------------
 * 这一行搬到了「计时行为 → 计时规则」组里，**读写逻辑一字未改**，所以判据也一字未改地
 * 跟着搬过来（原来在 `HostGeneralPanel.test.tsx` 的 g04/g05/g06/g08）。
 * 为什么值得单独一份：它是本页少数「直接写宿主参考设置」的行，写错形状（多带一个键、
 * 不钳制、失败后停在"看起来生效了"的数字上）都不会报错，只会让记录粒度悄悄不对。
 *
 * 断言盯的是**宿主命令的入参键名**，不是"点了有反应"：
 *   · 只提交 `minRecordSeconds` 一个键（多带一个就是把别的偏好覆盖掉）；
 *   · 越界提交前钳到 5 / 300（`input[type=number]` 的 min/max 只是 UA 校验，拦不住手输）；
 *   · 写失败要出红字，且输入框回退到已存值。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getReferenceSettings: vi.fn(),
  setAutostart: vi.fn(),
  updateReferenceSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAutostart: vi.fn(),
  themeGet: vi.fn(),
  themeSet: vi.fn(),
  accentGet: vi.fn(),
  accentSet: vi.fn(),
}));

vi.mock('../../../platform/desktop/hostSettingsGateway', () => ({ ...g }));

import SettingsMinRecordRow from './SettingsMinRecordRow';
import SettingsTrackingPanel from './SettingsTrackingPanel';
import { LocaleProvider } from '../../../shared/i18n/index.ts';
import { useSettingsStore } from '../services/host/settingsRuntimeStore';

const REFERENCE = { highlightColor: '#4DA3E8', minRecordSeconds: 45 };

let container: HTMLDivElement;
let root: Root;

async function mount(element: ReactElement = createElement(SettingsMinRecordRow)): Promise<void> {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function flush(): Promise<void> {
  return act(async () => { await Promise.resolve(); });
}

function secondsInput(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[aria-label="最短记录时长（秒）"]');
  if (!el) throw new Error('找不到最短记录时长输入框');
  return el;
}

/** 受控 input：React 19 只认原生 setter + `input` 事件 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('拿不到原生 value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  useSettingsStore.setState({ settings: null, referenceSettings: null, loaded: false });
  g.getReferenceSettings.mockResolvedValue(REFERENCE);
  g.updateReferenceSettings.mockResolvedValue({ ...REFERENCE, minRecordSeconds: 120 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('读回', () => {
  it('m01_reads_the_value_from_reference_settings_not_a_hardcoded_thirty', async () => {
    await mount();
    /* 值来自 `get_reference_settings`（45），不是写死的 30 */
    expect(secondsInput().value).toBe('45');
    expect(g.getReferenceSettings).toHaveBeenCalled();
    /* 这一行搬出 `HostGeneralPanel` 后要自己把参考设置读进来，不能指望那张卡顺带读 */
    expect(useSettingsStore.getState().referenceSettings?.minRecordSeconds).toBe(45);
  });

  it('m02_the_input_declares_the_adjustable_range_and_a_readable_name', async () => {
    await mount();
    const input = secondsInput();
    expect(input.getAttribute('min')).toBe('5');
    expect(input.getAttribute('max')).toBe('300');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    /* 行标题与控件同源：「最短记录时长」+ 单位「S」 */
    expect(container.textContent).toContain('最短记录时长');
    expect(container.textContent).toContain('S');
  });
});

describe('写路径：宿主命令的入参键名', () => {
  it('m03_committing_a_new_value_patches_only_min_record_seconds', async () => {
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '120'));
    act(() => pressEnter(input));
    await flush();

    expect(g.updateReferenceSettings).toHaveBeenCalledTimes(1);
    const patch = g.updateReferenceSettings.mock.calls[0][0] as Record<string, unknown>;
    /* 只带被改的那一个键；多带一个键就是把别的偏好一起覆盖掉 */
    expect(Object.keys(patch)).toEqual(['minRecordSeconds']);
    expect(patch.minRecordSeconds).toBe(120);
  });

  it('m04_out_of_range_values_are_clamped_before_hitting_the_host', async () => {
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '9999'));
    act(() => pressEnter(input));
    await flush();
    expect((g.updateReferenceSettings.mock.calls[0][0] as { minRecordSeconds: number }).minRecordSeconds).toBe(300);
  });

  it('m05_an_unchanged_or_empty_value_writes_nothing', async () => {
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '45')); /* 与已存值相同 */
    act(() => pressEnter(input));
    act(() => typeInto(input, '')); /* 清空 */
    act(() => pressEnter(input));
    await flush();
    expect(g.updateReferenceSettings).not.toHaveBeenCalled();
    expect(secondsInput().value).toBe('45'); /* 回退到当前值，不留空框 */
  });
});

describe('失败面：出错误文案，不静默', () => {
  it('m06_update_reference_failure_renders_an_alert_and_reverts_the_draft', async () => {
    g.updateReferenceSettings.mockRejectedValueOnce(new Error('设置保存失败：参数越界'));
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '90'));
    act(() => pressEnter(input));
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('设置保存失败：参数越界');
    /* 写失败后输入框不能停在一个「看起来生效了」的数字上 */
    expect(secondsInput().value).toBe('45');
  });
});

describe('落点：在「计时行为」的计时规则组里，第三行、单列', () => {
  /* 这一条钉的是**搬哪儿去了**，不是"能读到值"（那三条 m01–m06 管）。
     为什么值得单开：搬迁最典型的退化不是写坏逻辑，而是行被塞进组外的某个位置 ——
     用户还是能找到那条输入框，只是它不再跟在"合并间隔 / 空闲超时"后面，
     而"为什么 20 秒那条没存下来"恰恰是按计时规则一起看的（B5d 的搬迁理由）。 */
  const controls = (label: string) => ({
    label,
    hint: '',
    minutes: 1,
    minMinutes: 1,
    maxMinutes: 60,
    onMinutesChange: () => undefined,
  });

  it('m07_renders_as_the_third_row_of_the_time_rules_group', async () => {
    await mount(createElement(LocaleProvider, {
      locale: 'zh-CN',
      children: createElement(SettingsTrackingPanel, {
        idleTimeoutControl: controls('空闲超时'),
        timelineMergeGapControl: controls('合并间隔'),
        trackingPaused: false,
        onTrackingPausedChange: () => undefined,
        titleRecordingEnabled: true,
        onTitleRecordingEnabledChange: () => undefined,
      }),
    }));

    const groups = Array.from(container.querySelectorAll('.settings-preference-group'));
    const timeRules = groups.find((group) => (
      group.querySelector('.settings-preference-group-title')?.textContent === '时间规则'
    ));
    expect(timeRules, '找不到「时间规则」组（组标题被改名了？）').toBeTruthy();
    const rows = Array.from(
      timeRules!.querySelectorAll<HTMLElement>(':scope > .at-action-row .settings-preference-row'),
    );
    expect(rows).toHaveLength(3);
    /* 第三行 = 最短记录时长；前两行是分钟粒度的两项（这条是秒粒度，不能混进那两行里） */
    expect(rows[2].querySelector('.settings-preference-title')?.textContent).toBe('最短记录时长');
    expect(rows[2].querySelector('input[aria-label="最短记录时长（秒）"]')).toBeTruthy();
    /* 单列：三行是奇数，两列配对会在第二行留半格 */
    expect(timeRules!.querySelector('.settings-preference-pair')).toBeNull();
  });
});
