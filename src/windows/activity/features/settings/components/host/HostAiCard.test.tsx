/**
 * HostAiCard 行为判据（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 只钉三条用户能感觉到的规则：
 *   ① 密钥输入留空 = 不改；填了才随保存提交（三态里的两态）。
 *   ② 「保存并测试」先保存眼前草稿，再测；结果原文（含耗时）显示在卡底。
 *   ③ 今日汇总先保存眼前草稿再生成；`path: null` 必须说「仅预览」，不能让用户去日记里找。
 *   ④ 「获取可用模型」只填输入框不保存：拉到目录后仍由用户按「保存」决定落库。
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  aiApi: {
    get: vi.fn(),
    save: vi.fn(),
    test: vi.fn(),
    listModels: vi.fn(),
    suggestTags: vi.fn(),
    dailySummary: vi.fn(),
  },
}));

vi.mock('../../services/hostApi', () => ({
  aiApi: h.aiApi,
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import HostAiCard from './HostAiCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = {
  enabled: true,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  dailyEnabled: true,
  itemTagsEnabled: true,
  appTagsEnabled: true,
  dailyHeading: '#### AI 今日汇总',
  maxTagsPerTarget: 3,
};

let container: HTMLDivElement;
let root: Root;

const button = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.trim() === text);

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(async () => {
  h.aiApi.get.mockReset().mockResolvedValue({ config: CONFIG, hasKey: false, secretAvailable: true });
  h.aiApi.save.mockReset().mockImplementation(async (config: typeof CONFIG) => ({
    config,
    hasKey: true,
    secretAvailable: true,
  }));
  h.aiApi.test.mockReset().mockResolvedValue({ ok: true, message: '连接成功', latencyMs: 42 });
  h.aiApi.listModels.mockReset().mockResolvedValue(['deepseek-reasoner', 'deepseek-coder']);
  h.aiApi.dailySummary.mockReset().mockResolvedValue({
    date: '2026-11-18',
    markdown: '### 今天\n写完了标签与 AI。',
    path: null,
    at: 1,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(HostAiCard)); });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AI 设置卡', () => {
  it('ai01_留空密钥不提交_apiKey', async () => {
    await act(async () => { button('保存')?.click(); });
    await flush();
    expect(h.aiApi.save).toHaveBeenCalledWith(expect.objectContaining({ model: 'deepseek-chat' }), undefined);
  });

  it('ai02_填了密钥先保存再测试', async () => {
    const input = document.body.querySelector<HTMLInputElement>('input[type="password"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'sk-test');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('保存并测试')?.click(); });
    await flush();
    expect(h.aiApi.save).toHaveBeenCalledWith(expect.anything(), 'sk-test');
    expect(h.aiApi.test).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('连接成功');
    expect(document.body.textContent).toContain('42 ms');
  });

  it('ai03_汇总先保存草稿再生成_未落盘时明确说仅预览', async () => {
    await act(async () => { button('生成今日汇总')?.click(); });
    await flush();
    expect(h.aiApi.save).toHaveBeenCalledTimes(1);
    expect(h.aiApi.dailySummary).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('仅预览，未写入日记');
    expect(document.body.textContent).toContain('写完了标签与 AI');
  });

  it('ai04_获取可用模型只填输入框不保存', async () => {
    await act(async () => { button('获取可用模型')?.click(); });
    await flush();
    expect(h.aiApi.listModels).toHaveBeenCalledWith({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: null,
    });
    const modelSelect = document.getElementById('ai-model') as HTMLSelectElement | null;
    expect(modelSelect?.value).toBe('deepseek-reasoner');
    expect(Array.from(modelSelect?.options ?? []).map((option) => option.value)).toContain('deepseek-coder');
    await act(async () => {
      if (!modelSelect) return;
      modelSelect.value = 'deepseek-coder';
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(h.aiApi.save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('已获取 2 个模型，已填入 deepseek-reasoner');
  });
});