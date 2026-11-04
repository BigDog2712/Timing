/**
 * TickBar — 自适应测量的「信号源」用例（V0.4.2）
 * -----------------------------------------------------------------------------
 * `layoutWatch` 是这一次降耗改动的根：它决定**什么时候**重量布局。三条信号
 * （ResizeObserver / MutationObserver / 退避轮询）任一条漏了，窗口就会「内容长出来了
 * 但窗口还卡在旧宽度」；任一条把 `dispose` 漏了，窗口活多久泄漏多久。
 *
 * jsdom 没有 ResizeObserver，这里补一个只记账的假实现：用例只关心
 * 「有没有 observe / unobserve / disconnect」，不关心它怎么算尺寸。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchLayout, type LayoutWatchHandle } from './layoutWatch';

/** 只记账的 ResizeObserver 替身：记录被观察的元素，并允许手动触发回调。 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.observed.add(el);
  }

  unobserve(el: Element): void {
    this.observed.delete(el);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }

  /** 模拟「元素尺寸变了」。 */
  fire(): void {
    if (this.disconnected) return;
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** 本轮 watchLayout 建的那个 ResizeObserver（它在 ensureRoot 之前构造，必是第 0 个）。 */
function resizeObserver(): FakeResizeObserver {
  const first = FakeResizeObserver.instances[0];
  if (!first) throw new Error('watchLayout 没有创建 ResizeObserver');
  return first;
}

/** 让 MutationObserver 的回调（微任务）先跑完。 */
const flushMutation = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 造一棵 `.layer` 树并挂到 body 上。 */
function mountLayer(): { layer: HTMLDivElement; child: HTMLDivElement } {
  const layer = document.createElement('div');
  layer.className = 'layer';
  const child = document.createElement('div');
  layer.appendChild(child);
  document.body.appendChild(layer);
  return { layer, child };
}

let handle: LayoutWatchHandle | undefined;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('watchLayout — 观察范围', () => {
  it('首帧就把根整棵子树挂上 ResizeObserver', () => {
    const { layer, child } = mountLayer();
    handle = watchLayout({ resolveRoot: () => layer, onChanged: () => {} });

    const ro = resizeObserver();
    expect(ro.observed.has(layer)).toBe(true);
    expect(ro.observed.has(child)).toBe(true);
  });

  it('根还不存在时不报错，之后的信号会重试挂载', async () => {
    const onChanged = vi.fn();
    let layer: HTMLDivElement | null = null;
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    expect(resizeObserver().observed.size).toBe(0);

    /* 模拟首帧渲染：`.layer` 后出现，DOM 变动本身就是信号，顺带触发重试 */
    const mounted = mountLayer();
    layer = mounted.layer;
    await flushMutation();

    expect(onChanged).toHaveBeenCalled();
    expect(resizeObserver().observed.has(mounted.child)).toBe(true);
  });

  it('增量挂载：后插入的子节点也会被观察，摘掉时解除观察', async () => {
    const { layer } = mountLayer();
    handle = watchLayout({ resolveRoot: () => layer, onChanged: () => {} });
    const ro = resizeObserver();

    const late = document.createElement('div');
    layer.appendChild(late);
    await flushMutation();
    expect(ro.observed.has(late)).toBe(true);

    layer.removeChild(late);
    await flushMutation();
    expect(ro.observed.has(late)).toBe(false);
  });
});

describe('watchLayout — 信号', () => {
  it('元素尺寸变化（ResizeObserver 回调）算信号', () => {
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    resizeObserver().fire();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('DOM 增删算信号', async () => {
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    layer.appendChild(document.createElement('span'));
    await flushMutation();
    expect(onChanged).toHaveBeenCalled();
  });

  it('class 变化算信号（浮层开合走这条路）', async () => {
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    layer.className = 'layer is-open';
    await flushMutation();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('watchLayout — 退避轮询', () => {
  it('有信号时按 250ms 兜底；空闲超过 1200ms 后退到 1000ms', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    /* 刚启动就在「热窗口」内：1.2s 内应有 250/500/750/1000 四次 */
    vi.advanceTimersByTime(1200);
    const hot = onChanged.mock.calls.length;
    expect(hot).toBeGreaterThanOrEqual(4);

    /* 之后就退到 1000ms 一档：再走 1000ms 只多一次，而不是四次 */
    vi.advanceTimersByTime(1000);
    expect(onChanged.mock.calls.length - hot).toBe(1);
  });

  it('轮询自己不给节拍加热（否则等于回到恒定 250ms）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    handle = watchLayout({ resolveRoot: () => layer, onChanged });

    vi.advanceTimersByTime(4000);
    const idle = onChanged.mock.calls.length;
    /* 4s 若一直高频会是 16 次；退避后约 4 + 3 = 7 次 */
    expect(idle).toBeLessThan(10);

    /* 一次真实信号把节拍重新加热 */
    resizeObserver().fire();
    vi.advanceTimersByTime(250);
    expect(onChanged.mock.calls.length).toBeGreaterThan(idle);
  });
});

describe('watchLayout — 收尾', () => {
  it('dispose 断开两个 observer 并停掉轮询', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    const local = watchLayout({ resolveRoot: () => layer, onChanged });

    vi.advanceTimersByTime(500);
    expect(onChanged).toHaveBeenCalled();
    const before = onChanged.mock.calls.length;

    local.dispose();
    expect(resizeObserver().disconnected).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(onChanged).toHaveBeenCalledTimes(before);

    /* MutationObserver 也断了：DOM 变动不再回调 */
    layer.appendChild(document.createElement('i'));
    vi.useRealTimers();
    await flushMutation();
    expect(onChanged).toHaveBeenCalledTimes(before);
  });

  it('dispose 之后手动触发尺寸回调也不再回调（防野回调）', () => {
    const { layer } = mountLayer();
    const onChanged = vi.fn();
    const local = watchLayout({ resolveRoot: () => layer, onChanged });
    const ro = resizeObserver();

    local.dispose();
    ro.disconnected = false; // 模拟「断开之后仍收到一次回调」的时序
    ro.fire();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
