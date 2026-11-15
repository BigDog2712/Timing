/**
 * HostThemeCard（分析窗「外观与配色」组的主题与主色卡）冒烟测试 —— [0.12.1] QA 补测
 * -----------------------------------------------------------------------------
 * 这张卡是全应用**唯一**还能写主色的地方（宿主那份 `ThemePicker` 已无生产消费者），
 * 所以两条写路径都必须钉住入参：
 *   · 深浅切换 → `theme_set(mode)`，入参是裸字符串；
 *   · 单色改动 → `accent_set(patch)`，**只带被改的那一个键**（带全四键 = 顺手覆盖别人的配色）。
 *
 * 手法与另三份一致：mock 网关、`react-dom/client` + `act`（仓库未装 @testing-library）。
 * 颜色控件（`QuietColorField`）要求 `LocaleProvider`——它内部读 i18n 文案，缺 Provider 会抛
 * 「LocaleProvider is required for localized UI」，所以这里先 `loadLocaleText('zh-CN')`
 * 再用真实 Provider 包一层（源码语言就是 zh-CN，没有网络请求）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({
  themeGet: vi.fn(),
  themeSet: vi.fn(),
  accentGet: vi.fn(),
  accentSet: vi.fn(),
}));

/* `DEFAULT_HOST_ACCENTS` 等常量必须用**真值**：恢复默认那条断言靠它比对「四键全带」，
   伪造一份就等于把被测代码和测试用同一份常量互证。 */
vi.mock('../../../../platform/desktop/hostSettingsGateway', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...g };
});
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

import HostThemeCard from './HostThemeCard';
import { LocaleProvider } from '../../../../shared/i18n/index.ts';
import { loadLocaleText } from '../../../../shared/i18n/runtime.ts';

const ACCENTS = { running: '#4DA3E8', warn: '#E8A33D', done: '#4CC38A', bar: null };

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeAll(async () => {
  await loadLocaleText('zh-CN');
});

async function mount(): Promise<void> {
  await act(async () => {
    /* `children` 必须写在 props 里：`LocaleProvider` 把 children 声明成必填属性，
       用 `createElement(P, props, child)` 的第三参数形式 tsc 会报 TS2769。 */
    root.render(createElement(LocaleProvider, {
      locale: 'zh-CN',
      children: createElement(HostThemeCard, { id: 's-theme' }),
    }));
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

function themeRadio(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    .find((el2) => el2.textContent?.includes(label));
  if (!el) throw new Error(`找不到主题选项「${label}」`);
  return el;
}

function buttonByText(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`找不到「${label}」按钮`);
  return el;
}

/** 受控 input：React 19 只认原生 setter + `input` 事件 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('拿不到原生 value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  g.themeGet.mockResolvedValue('dark');
  g.themeSet.mockImplementation((next: string) => Promise.resolve(next));
  g.accentGet.mockResolvedValue({ ...ACCENTS });
  g.accentSet.mockResolvedValue({ ...ACCENTS });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  /* 颜色弹层是 createPortal 到 document.body 的：卸载后必须自己带走，否则污染下一个用例 */
  document.body.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
});

afterAll(() => {
  document.body.innerHTML = '';
});

describe('挂载与读回', () => {
  it('t01_mounts_with_three_modes_and_four_accent_rows', async () => {
    await mount();
    expect(text()).toContain('主题与主色');
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(g.themeGet).toHaveBeenCalledTimes(1);
    expect(g.accentGet).toHaveBeenCalledTimes(1);
    /* 当前模式来自宿主（dark），不是写死的默认值 */
    expect(themeRadio('深色').getAttribute('aria-checked')).toBe('true');
    expect(themeRadio('浅色').getAttribute('aria-checked')).toBe('false');
    /* 四行配色各自把当前 hex 印出来；`bar` 未配置 → 显示跟随令牌的兜底底色 */
    expect(text()).toContain('#4DA3E8');
    expect(text()).toContain('#E8A33D');
    expect(text()).toContain('#4CC38A');
    expect(text()).toContain('#0E0F12');
  });

  it('t02_read_failure_is_reported_not_silently_swallowed', async () => {
    g.accentGet.mockRejectedValue(new Error('宿主返回的四色格式不对'));
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('宿主返回的四色格式不对');
  });
});

describe('写路径：theme_set / accent_set 的入参', () => {
  it('t03_picking_a_mode_calls_theme_set_with_the_bare_mode', async () => {
    await mount();
    act(() => themeRadio('浅色').click());
    await flush();

    expect(g.themeSet).toHaveBeenCalledTimes(1);
    expect(g.themeSet).toHaveBeenCalledWith('light');
    /* 回写以后端实际生效值为准（宿主可能把 light 归一到别的） */
    expect(g.themeGet.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(themeRadio('浅色').getAttribute('aria-checked')).toBe('true');
  });

  it('t04_theme_failure_rolls_back_and_shows_the_message', async () => {
    g.themeSet.mockRejectedValueOnce(new Error('theme_set 不可用'));
    await mount();
    act(() => themeRadio('浅色').click());
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('theme_set 不可用');
    /* 乐观更新必须回滚：UI 停在一个没落库的模式上，用户下次打开会被打脸 */
    expect(themeRadio('深色').getAttribute('aria-checked')).toBe('true');
  });

  it('t05_editing_one_accent_sends_only_that_key', async () => {
    await mount();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="选择计时中颜色"]');
    if (!trigger) throw new Error('找不到「计时中」色块触发器');
    act(() => trigger.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('色块没有弹出对话框');
    const hex = dialog.querySelector('input:not([type="range"])') as HTMLInputElement | null;
    if (!hex) throw new Error('弹层里没有 HEX 输入框');
    act(() => typeInto(hex, '#FF0000'));
    await flush();

    expect(g.accentSet).toHaveBeenCalledTimes(1);
    const patch = g.accentSet.mock.calls[0][0] as Record<string, unknown>;
    /* 只带 running 一个键：多带一个就是把 warn/done/bar 一起覆盖掉 */
    expect(patch).toEqual({ running: '#FF0000' });
    expect(Object.keys(patch)).toHaveLength(1);
  });

  it('t06_restore_defaults_sends_all_four_keys', async () => {
    await mount();
    act(() => buttonByText('恢复默认配色').click());
    await flush();

    expect(g.accentSet).toHaveBeenCalledTimes(1);
    const patch = g.accentSet.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(['bar', 'done', 'running', 'warn']);
    /* `bar: null` = 跟随主题令牌，不能写成某个具体 hex */
    expect(patch.bar).toBeNull();
  });

  it('t07_accent_failure_shows_the_message_and_keeps_busy_clear', async () => {
    g.accentSet.mockRejectedValueOnce(new Error('accent_set 失败：权限不足'));
    await mount();
    act(() => buttonByText('恢复默认配色').click());
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('accent_set 失败：权限不足');
    expect(buttonByText('恢复默认配色').disabled).toBe(false);
  });
});
