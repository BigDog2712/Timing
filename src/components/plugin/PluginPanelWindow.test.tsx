/**
 * PluginPanelWindow —— 声明式面板的渲染与动作
 * -----------------------------------------------------------------------------
 * 钉三件事：文本/数据块按声明渲染、按钮执行动作并把回执显示出来、
 * 插件被删（清单里没有）时给可读提示而不是白屏。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInfo } from '../../types/domain';
import { usePluginStore } from '../../stores/pluginStore';
import { PluginPanelWindow } from './PluginPanelWindow';

const api = vi.hoisted(() => ({
  panelData: vi.fn(),
  runAction: vi.fn(),
  openPanel: vi.fn(),
}));

vi.mock('../../services/api', () => ({ pluginApi: api }));

const PLUGIN: PluginInfo = {
  id: 'demo',
  name: '演示插件',
  version: '1.0.0',
  apiVersion: 3,
  description: '',
  source: 'user',
  dir: 'C:\\plugins\\demo',
  enabled: true,
  error: null,
  quickTimers: [],
  panels: [
    {
      id: 'weekly',
      title: '本周概览',
      blocks: [
        { type: 'text', text: '这一段是插件写的说明。' },
        { type: 'stats', source: 'records.byItem', label: '各事项', params: { days: 7 } },
        {
          type: 'actions',
          items: [{ label: '开始摸鱼', action: 'timer.start', params: { item: '摸鱼' } }],
        },
      ],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function mount(path = '/?w=panel&plugin=demo&panel=weekly'): Promise<string> {
  window.history.replaceState({}, '', path);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(PluginPanelWindow));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container.innerHTML;
}

describe('PluginPanelWindow', () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    usePluginStore.setState({ plugins: [PLUGIN], loaded: true, loading: false, error: null });
    api.panelData.mockReset().mockResolvedValue([
      { label: '摸鱼', detail: '3 小时', ratio: 1 },
      { label: '写代码', detail: '1 小时', ratio: 0.4 },
    ]);
    api.runAction.mockReset().mockResolvedValue({ message: '已开始：摸鱼' });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState({}, '', '/');
  });

  it('按声明渲染文本块与数据块', async () => {
    const html = await mount();
    expect(html).toContain('这一段是插件写的说明。');
    expect(html).toContain('各事项');
    expect(html).toContain('摸鱼');
    /* stats 块要画条；list 块不画。这里只声明了 stats，所以条形存在。 */
    expect(html).toContain('plgp__meter');
  });

  it('点按钮执行动作并显示回执', async () => {
    await mount();
    const button = [...container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('开始摸鱼'),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(api.runAction).toHaveBeenCalledWith('timer.start', { item: '摸鱼' });
    expect(container.innerHTML).toContain('已开始：摸鱼');
  });

  it('插件不在清单里时给出可读提示', async () => {
    usePluginStore.setState({ plugins: [], loaded: true });
    const html = await mount();
    expect(html).toContain('找不到插件「demo」');
  });

  it('面板 id 对不上时说明是哪个 id', async () => {
    const html = await mount('/?w=panel&plugin=demo&panel=nope');
    expect(html).toContain('nope');
  });
});
