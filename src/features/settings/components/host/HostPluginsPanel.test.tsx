/**
 * HostPluginsPanel（分析窗「通用与启动」组的插件面）冒烟测试 —— [0.12.1] QA 补测
 * -----------------------------------------------------------------------------
 * 三种状态各自一条（列表 / 空态 / 失败态），外加一条「坏插件也要列出来」：
 * 插件目录里 JSON 坏掉的那个如果静默消失，用户唯一的线索就没了——这是本面板的设计要点
 * （文件头注释「展示的是磁盘事实」），也是搬迁时最容易丢的一条。
 *
 * 空态判据必须只在**首次扫描完成之后**成立（`loaded && length===0`），否则打开页签第一帧
 * 会闪一句「还没有安装插件」。这条也用「首帧不该出现空态」钉住。
 *
 * mock 网关（`hostPluginsGateway`），不连真 IPC；仓库未装 @testing-library，
 * 按仓内既有写法用 `react-dom/client` + `act`。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({ pluginList: vi.fn(), pluginOpenDir: vi.fn() }));

vi.mock('../../../../platform/desktop/hostPluginsGateway', () => ({ ...g }));
/* hostApi 会一并被加载（面板只 import 门面里的 pluginApi），把另两个网关也挡掉 */
vi.mock('../../../../platform/desktop/hostSyncGateway', () => ({
  mdSyncGet: vi.fn(), mdSyncSave: vi.fn(), mdSyncRun: vi.fn(), mdSyncOpen: vi.fn(),
  mdSyncTest: vi.fn(), mdBackupList: vi.fn(), mdBackupOpen: vi.fn(), mdBackupRestore: vi.fn(),
  mdBackupExport: vi.fn(), dataRootGet: vi.fn(), dataRootChange: vi.fn(), dataRootOpen: vi.fn(),
  getMigrationInfo: vi.fn(), openLegacyDir: vi.fn(), dailyStatusGet: vi.fn(),
  dailyStatusSet: vi.fn(), mdSafPick: vi.fn(), mdSafStatus: vi.fn(),
}));
vi.mock('../../../../platform/desktop/hostSettingsGateway', () => ({
  getSettings: vi.fn(), getReferenceSettings: vi.fn(), setAutostart: vi.fn(),
  updateReferenceSettings: vi.fn(), updateSettings: vi.fn(), getAutostart: vi.fn(),
  themeGet: vi.fn(), themeSet: vi.fn(), accentGet: vi.fn(), accentSet: vi.fn(),
}));

import { HostPluginsPanel } from './HostPluginsPanel';
import { usePluginStore } from '../../services/host/pluginRuntimeStore';

const OK_PLUGIN = {
  id: 'quick', name: '快捷计时', version: '1.2.0', apiVersion: 2,
  description: '三条出厂快捷计时', source: 'exe' as const, dir: 'C:\\plugins\\quick',
  enabled: true, error: null,
  quickTimers: [{ item: '喝水', minutes: 5 }], warnings: [],
};

const BROKEN_PLUGIN = {
  id: 'broken', name: 'broken', version: '', apiVersion: 0, description: '',
  source: 'user' as const, dir: 'C:\\plugins\\broken', enabled: false,
  error: 'plugin.json 解析失败：unexpected end of JSON', quickTimers: [], warnings: [],
};

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(HostPluginsPanel));
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

function buttonByText(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`找不到「${label}」按钮`);
  return el;
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  usePluginStore.setState({ dir: '', plugins: [], loaded: false, loading: false, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('列表态', () => {
  it('p01_lists_every_plugin_from_disk_with_its_source_and_contributions', async () => {
    g.pluginList.mockResolvedValue({ dir: 'C:\\plugins', plugins: [OK_PLUGIN], quickTimers: [] });
    await mount();

    expect(container.querySelectorAll('.plg__item')).toHaveLength(1);
    expect(text()).toContain('快捷计时');
    expect(text()).toContain('随包'); /* source=exe 要翻成中文，不能把 'exe' 直接印给用户 */
    expect(text()).toContain('v1.2.0');
    expect(text()).toContain('快捷计时 1 项'); /* 贡献项摘要 */
    expect(container.querySelector('.plg__path')?.textContent).toBe('C:\\plugins');
    expect(container.querySelector('.plg__empty')).toBeNull();
  });

  it('p02_a_broken_plugin_is_listed_with_its_reason_instead_of_vanishing', async () => {
    g.pluginList.mockResolvedValue({ dir: 'C:\\plugins', plugins: [BROKEN_PLUGIN], quickTimers: [] });
    await mount();

    expect(container.querySelectorAll('.plg__item')).toHaveLength(1);
    expect(container.querySelector('.plg__item')?.getAttribute('data-broken')).toBe('true');
    expect(text()).toContain('未能载入：plugin.json 解析失败');
    /* 坏掉的那个不许被算成「空目录」 */
    expect(container.querySelector('.plg__empty')).toBeNull();
  });
});

describe('空态与失败态', () => {
  it('p03_empty_state_only_after_the_scan_finished', async () => {
    g.pluginList.mockResolvedValue({ dir: 'C:\\plugins', plugins: [], quickTimers: [] });
    await mount();
    expect(container.querySelector('.plg__empty')?.textContent).toContain('还没有安装插件');
    expect(container.querySelectorAll('.plg__item')).toHaveLength(0);
  });

  it('p04_load_failure_shows_the_host_message_not_an_empty_list', async () => {
    g.pluginList.mockRejectedValue(new Error('插件目录不可读：拒绝访问'));
    await mount();

    expect(container.querySelector('.plg__error')?.textContent).toContain('插件目录不可读：拒绝访问');
    /* 读失败 ≠ 没装插件：这两句同时出现会把用户引到错的方向 */
    expect(container.querySelector('.plg__empty')).toBeNull();
  });
});

describe('动作', () => {
  it('p05_reload_rescans_and_open_dir_goes_through_the_gateway', async () => {
    g.pluginList.mockResolvedValue({ dir: 'C:\\plugins', plugins: [OK_PLUGIN], quickTimers: [] });
    g.pluginOpenDir.mockResolvedValue(undefined);
    await mount();
    expect(g.pluginList).toHaveBeenCalledTimes(1);

    act(() => buttonByText('重新加载').click());
    await flush();
    expect(g.pluginList).toHaveBeenCalledTimes(2);

    act(() => buttonByText('打开目录').click());
    await flush();
    expect(g.pluginOpenDir).toHaveBeenCalledTimes(1);
  });
});
