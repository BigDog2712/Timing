/**
 * Timing — appearanceStore 悬浮形态单测（V0.11.0 / ADR-038）
 * -----------------------------------------------------------------------------
 * 只钉住「形态」这一条新链路，覆盖四件事：
 *   1. 没有存量 → 默认悬浮条（升级用户不该被莫名收起）；
 *   2. 存了 `dot` → 回落小圆点；
 *   3. 非法值 → 一律回落悬浮条（手改坏 localStorage 不该让应用起不来）；
 *   4. 切换形态 → 落盘 + 立刻改运行态；调不透明度不许顺手动运行态。
 * 读数口径（倒计时剩余 / 待命时长）在 CollapsedDot 里，属组件行为，不在本文件范围。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'timing.appearance.v1';

/** 每个用例都要拿到「刚刚从存储里读出来」的 store，必须重置模块图 */
async function load(): Promise<typeof import('./appearanceStore')> {
  vi.resetModules();
  return import('./appearanceStore');
}

describe('appearanceStore · floatForm', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没有存量时默认悬浮条', async () => {
    const { useAppearanceStore } = await load();
    expect(useAppearanceStore.getState().floatForm).toBe('bar');
  });

  it('存量是 dot 时回落小圆点', async () => {
    localStorage.setItem(KEY, JSON.stringify({ floatForm: 'dot' }));
    const { useAppearanceStore } = await load();
    expect(useAppearanceStore.getState().floatForm).toBe('dot');
  });

  it('非法值一律回落悬浮条', async () => {
    localStorage.setItem(KEY, JSON.stringify({ floatForm: 'bubble' }));
    const { useAppearanceStore } = await load();
    expect(useAppearanceStore.getState().floatForm).toBe('bar');
  });

  it('切到小圆点会落盘并立刻收起，切回悬浮条会展开', async () => {
    const { useAppearanceStore } = await load();
    const { useUiStore } = await import('./uiStore');

    useAppearanceStore.getState().setFloatForm('dot');
    expect(useAppearanceStore.getState().floatForm).toBe('dot');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').floatForm).toBe('dot');
    expect(useUiStore.getState().collapsed).toBe(true);

    useAppearanceStore.getState().setFloatForm('bar');
    expect(useUiStore.getState().collapsed).toBe(false);
  });

  it('调不透明度不会顺带改运行态', async () => {
    const { useAppearanceStore } = await load();
    const { useUiStore } = await import('./uiStore');

    useUiStore.getState().setCollapsed(true);
    useAppearanceStore.getState().setTextOpacity(0.5);

    expect(useUiStore.getState().collapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').floatForm).toBe('bar');
  });
});
