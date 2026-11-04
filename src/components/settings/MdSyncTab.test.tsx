import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncView } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

const BINDINGS: MdSyncBinding[] = [
  {
    kind: 'timers',
    enabled: true,
    root: 'C:\\Vault',
    file: '{date}.md',
    heading: '#### 事项计时',
  },
  {
    kind: 'notes',
    enabled: true,
    root: 'C:\\Vault',
    file: '{date}.md',
    heading: '#### 便利贴',
  },
];

const VIEW: MdSyncView = {
  installed: true,
  pluginId: 'md-sync',
  pluginName: 'Markdown 同步',
  pluginVersion: '1.0.0',
  today: '2026-10-20',
  config: { enabled: true, bindings: BINDINGS },
  status: {
    lastSyncAt: null,
    lastError: null,
    bindings: BINDINGS.map((binding) => ({
      kind: binding.kind,
      path: `C:\\Vault\\2026-10-20.md`,
      exists: true,
      lastError: null,
      lastSyncAt: null,
      lastDirection: null,
    })),
  },
};

const api = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  open: vi.fn(),
}));

vi.mock('../../services/api', () => ({ mdSyncApi: api }));

import { MdSyncTab } from './MdSyncTab';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdSyncTab));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

async function setValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('MdSyncTab —— 同步设置页', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.save.mockReset();
    api.run.mockReset();
    api.get.mockResolvedValue(VIEW);
    api.save.mockImplementation(async (config: MdSyncView['config']) => ({ ...VIEW, config }));
    useMdSyncStore.setState({
      view: null,
      loaded: false,
      loading: false,
      saving: false,
      error: null,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
  });

  it('加载后按 kind 展示两个落点，并把日期令牌展开到预览', async () => {
    await mount();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('事项计时');
    expect(container.textContent).toContain('便利贴');
    expect(container.textContent).toContain('C:\\Vault\\2026-10-20.md');
  });

  it('关闭总开关后自动收纳落点设置，重新打开后展开', async () => {
    api.get.mockResolvedValue({ ...VIEW, config: { ...VIEW.config, enabled: false } });
    await mount();
    expect(container.textContent).toContain('同步已关闭，落点设置已自动收纳');
    expect(container.querySelector('#md-sync-settings')?.hasAttribute('hidden')).toBe(true);

    const total = container.querySelector('[aria-label="启用 Markdown 同步"]') as HTMLButtonElement;
    await act(async () => {
      total.click();
    });

    expect(container.querySelector('#md-sync-settings')?.hasAttribute('hidden')).toBe(false);
  });

  it('改草稿后「立即同步」禁用，保存把新根目录交给后端', async () => {
    await mount();
    const input = container.querySelector('input.sync__input') as HTMLInputElement;
    await setValue(input, 'D:\\NewVault');
    expect(button('立即同步').disabled).toBe(true);

    await act(async () => {
      button('保存并同步').click();
      await Promise.resolve();
    });

    expect(api.save).toHaveBeenCalledWith({
      enabled: true,
      bindings: [BINDINGS[0], BINDINGS[1]].map((binding, index) =>
        index === 0 ? { ...binding, root: 'D:\\NewVault' } : binding,
      ),
    });
    expect(button('立即同步').disabled).toBe(false);
  });
});
