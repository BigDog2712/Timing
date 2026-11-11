/**
 * HostGeneralPanel（分析窗「通用与启动」组的宿主通用面）冒烟测试 —— [0.12.1] QA 补测
 * -----------------------------------------------------------------------------
 * 这张卡是「搬过来之后最容易写错一类」的样板：它**不走草稿/保存**，改一下直接写宿主设置。
 * 所以断言必须盯住 `update_reference_settings` / 设置开机自启这两条**宿主命令**的入参键名，
 * 而不是「点了有反应」。
 *
 * 与 HostSyncPanel.test.tsx 同一手法：mock 网关（`platform/desktop/hostSettingsGateway`），
 * 让 `settingsApi` 门面、`settingsRuntimeStore`、面板三层都跑真代码。
 * 仓库未装 @testing-library，用 `react-dom/client` + `act`（仓内既有写法）。
 */
import { act, createElement } from 'react';
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

vi.mock('../../../../platform/desktop/hostSettingsGateway', () => ({ ...g }));
vi.mock('../../../../platform/desktop/hostSyncGateway', () => ({
  mdSyncGet: vi.fn(), mdSyncSave: vi.fn(), mdSyncRun: vi.fn(), mdSyncOpen: vi.fn(),
  mdSyncTest: vi.fn(), mdBackupList: vi.fn(), mdBackupOpen: vi.fn(), mdBackupRestore: vi.fn(),
  mdBackupExport: vi.fn(), dataRootGet: vi.fn(), dataRootChange: vi.fn(), dataRootOpen: vi.fn(),
  getMigrationInfo: vi.fn(), openLegacyDir: vi.fn(), dailyStatusGet: vi.fn(),
  dailyStatusSet: vi.fn(), mdSafPick: vi.fn(), mdSafStatus: vi.fn(),
}));
vi.mock('../../../../platform/desktop/hostPluginsGateway', () => ({
  pluginList: vi.fn(), pluginOpenDir: vi.fn(),
}));

import { HostGeneralPanel } from './HostGeneralPanel';
import { useSettingsStore } from '../../services/host/settingsRuntimeStore';

const SETTINGS = { autostartEnabled: false };
const REFERENCE = { highlightColor: '#4DA3E8', minRecordSeconds: 45 };

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

async function mount(props: { showAutostart?: boolean } = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(HostGeneralPanel, props));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function flush(): Promise<void> {
  return act(async () => { await Promise.resolve(); });
}

function text(): string {
  return container.textContent ?? '';
}

function switchOf(label: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`);
  if (!el) throw new Error(`找不到开关「${label}」`);
  return el;
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
  g.getSettings.mockResolvedValue(SETTINGS);
  g.getReferenceSettings.mockResolvedValue(REFERENCE);
  g.setAutostart.mockResolvedValue(true);
  g.updateReferenceSettings.mockResolvedValue({ ...REFERENCE, minRecordSeconds: 120 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('挂载与读回', () => {
  it('g01_mounts_and_shows_autostart_plus_min_record_seconds', async () => {
    await mount();
    expect(text()).toContain('开机自启');
    expect(text()).toContain('最短记录时长');
    /* 值来自 `get_reference_settings`，不是写死的 30 */
    expect(secondsInput().value).toBe('45');
    expect(g.getSettings).toHaveBeenCalled();
    expect(g.getReferenceSettings).toHaveBeenCalled();
  });

  it('g02_autostart_row_can_be_hidden_for_mobile', async () => {
    await mount({ showAutostart: false });
    expect(container.querySelector('[role="switch"][aria-label="开机自启"]')).toBeNull();
    /* 只是藏起那一行，最短记录时长照旧 */
    expect(secondsInput()).toBeTruthy();
  });
});

describe('写路径：宿主命令的入参键名', () => {
  it('g03_toggling_autostart_calls_set_autostart_with_a_boolean', async () => {
    await mount();
    act(() => switchOf('开机自启').click());
    await flush();

    expect(g.setAutostart).toHaveBeenCalledTimes(1);
    /* 入参是裸布尔，不是 `{enabled: true}` —— 写错形状后端 serde 直接报错 */
    expect(g.setAutostart).toHaveBeenCalledWith(true);
    /* 写完必须回读：勾选状态以后端实际生效值为准（写注册表可能失败） */
    expect(g.getSettings.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('g04_committing_a_new_duration_patches_only_min_record_seconds', async () => {
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

  it('g05_out_of_range_values_are_clamped_before_hitting_the_host', async () => {
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '9999'));
    act(() => pressEnter(input));
    await flush();
    expect((g.updateReferenceSettings.mock.calls[0][0] as { minRecordSeconds: number }).minRecordSeconds).toBe(300);
  });

  it('g06_an_unchanged_or_empty_value_writes_nothing', async () => {
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
  it('g07_set_autostart_failure_renders_an_alert', async () => {
    g.setAutostart.mockRejectedValueOnce(new Error('写入注册表被拒绝（拒绝访问）'));
    await mount();
    act(() => switchOf('开机自启').click());
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('写入注册表被拒绝（拒绝访问）');
  });

  it('g08_update_reference_failure_renders_an_alert', async () => {
    g.updateReferenceSettings.mockRejectedValueOnce(new Error('设置保存失败：参数越界'));
    await mount();
    const input = secondsInput();
    act(() => typeInto(input, '90'));
    act(() => pressEnter(input));
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('设置保存失败：参数越界');
    /* 空值回退：写失败后输入框不能停在一个「看起来生效了」的数字上 */
    expect(secondsInput().value).toBe('45');
  });
});
