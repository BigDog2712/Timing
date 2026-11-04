/**
 * `PluginsTab` —— 空态出现的时机（V0.3.4，ADR-023）。
 *
 * 两件事在这里被钉住：
 *   1. **空态必须可达**：V0.3.4 起宿主不再往用户目录播种示例包，全新安装的
 *      `plugins` 真的是空数组——如果没有空态文案，用户面对的是一块没有任何解释的留白。
 *   2. **空态不能在首帧闪**：`plugins` 初值就是 `[]`，只看长度的话，打开页签的第一帧会
 *      先冒出一句「还没有安装插件」再跳成真实列表（磁盘慢时肉眼可见）。条件里必须带 `loaded`。
 *
 * 渲染走真实 DOM（`createRoot` + `act`）：zustand v5 在 `renderToStaticMarkup` 下读的是
 * **初始** state（`useSyncExternalStore` 的 getInitialState），SSR 断言在这个项目里不可用。
 * 这里也让真实的 `load()` 链路跑一遍（只把最外层的「取插件列表」这一步换成假实现），
 * 顺带守住 store 的「加载中 / 成功 / 失败」三态与组件的连线。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '../../services/ipc';
import { usePluginStore } from '../../stores/pluginStore';
import type { PluginInfo, PluginListResult } from '../../types/domain';
import { PluginsTab } from './PluginsTab';

/* React 19 的 act() 需要这个全局标记，否则每次 act 都会打一条 deprecation 警告 */
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY: PluginListResult = {
  dir: 'C:\\Users\\me\\AppData\\Roaming\\com.tickbar.app\\plugins',
  plugins: [],
  quickTimers: [],
};

const PLUGIN: PluginInfo = {
  id: 'demo',
  name: '演示插件',
  version: '1.0.0',
  apiVersion: 1,
  description: '',
  source: 'user',
  dir: 'C:\\plugins\\demo',
  enabled: true,
  error: null,
  quickTimers: [{ item: '喝水', minutes: 5 }],
  panels: [],
};

let container: HTMLDivElement;
let root: Root;

async function mount(props: Parameters<typeof PluginsTab>[0] = {}): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(PluginsTab, props));
  });
  /* 让 load() 里的 promise 链在同一个 act 里落地 */
  await act(async () => {
    await Promise.resolve();
  });
  return container.innerHTML;
}

const EMPTY_TEXT = '还没有安装插件';

describe('PluginsTab —— 空态条件 = loaded && plugins.length === 0 && !error', () => {
  beforeEach(() => {
    usePluginStore.setState({
      dir: '',
      plugins: [],
      quickTimers: [],
      loaded: false,
      loading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    vi.restoreAllMocks();
  });

  it('加载中（首帧）不显示空态，避免闪一句「还没有安装插件」', async () => {
    /* 永不 resolve：模拟磁盘慢，此时 loaded 必须还是 false */
    vi.spyOn(ipc, 'pluginList').mockReturnValue(new Promise<PluginListResult>(() => {}));

    const html = await mount();

    expect(html).not.toContain(EMPTY_TEXT);
    expect(html, '路径还没拿到时给占位而不是空白').toContain('正在定位插件目录');
  });

  it('扫描完成且一个插件都没有 → 显示空态文案', async () => {
    vi.spyOn(ipc, 'pluginList').mockResolvedValue(EMPTY);

    const html = await mount();

    expect(html).toContain(EMPTY_TEXT);
    expect(html).toContain(EMPTY.dir);
  });

  it('有插件时列出插件，不显示空态', async () => {
    vi.spyOn(ipc, 'pluginList').mockResolvedValue({
      ...EMPTY,
      plugins: [PLUGIN],
      quickTimers: PLUGIN.quickTimers,
    });

    const html = await mount();

    expect(html).not.toContain(EMPTY_TEXT);
    expect(html).toContain(PLUGIN.name);
    expect(html).toContain('用户'); // source 标签
  });

  it('整体加载失败时显示错误而不是空态（静默变成「你没装插件」是最难排查的形态）', async () => {
    vi.spyOn(ipc, 'pluginList').mockRejectedValue(new Error('插件目录不可读'));

    const html = await mount();

    expect(html).not.toContain(EMPTY_TEXT);
    expect(html).toContain('插件目录不可读');
  });
});
