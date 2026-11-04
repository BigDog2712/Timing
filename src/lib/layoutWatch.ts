/**
 * TickBar — 「布局可能变了」的事件源（给主窗自适应尺寸用）
 * -----------------------------------------------------------------------------
 * 为什么单独成文件：`useWindowAutoFit` 每量一次要对候选元素做
 * `getBoundingClientRect()` + `getComputedStyle()`，那是**强制同步重排**——
 * 一秒四次无条件跑，窗口空闲时也在烧 CPU（笔记本上就是风扇转、掉电快）。
 * 所以「什么时候该量」必须由事件决定；这层编排留在 hook 里会把它顶到 300 行，
 * 也测不动。抽出来之后 hook 只负责「测量 → 裁决 → 落地」。
 *
 * 三个信号源，按代价从低到高：
 *   1. ResizeObserver —— 元素尺寸真的变了（含 CSS transition 逐帧、字体加载后重排）；
 *   2. MutationObserver —— DOM 增删 / class 与 style 变化（浮层开合、菜单换向）；
 *   3. 空闲退避轮询 —— 前两者都收不到的残余。有信号后 1.2s 内按 250ms 兜底，
 *      之后退到 1000ms（旧实现是恒定 250ms，窗口空闲时也每秒重排四次）。
 *
 * 轮询**自己**不算信号，否则它会一直把自己留在高频档，等于回到旧行为。
 */

/** 有信号之后的一段时间里，兜底轮询保持高频（毫秒） */
const HOT_POLL_MS = 250;
/** 长时间没有信号时的兜底轮询间隔（毫秒） */
const COLD_POLL_MS = 1000;
/** 「刚刚有过信号」的判定窗口（毫秒），要大于一次测量 + 一次窗口缩放往返 */
const HOT_WINDOW_MS = 1200;
/**
 * 只用来「加热」而不立刻测量的交互事件。
 * 不在这里直接触发测量：指针移动每秒几十次，每次都重量等于把旧的 4 次/秒换成 60 次/秒。
 * 悬停引起的尺寸变化交给 ResizeObserver —— 它才是真正「变了」的那个信号。
 */
const INTERACTION_EVENTS: readonly (keyof WindowEventMap)[] = [
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
];

export interface LayoutWatchOptions {
  /** 解析观察根（主窗是 `.layer`）。返回 null 表示还没挂上，下次信号再试。 */
  resolveRoot: () => Element | null;
  /** 「可能影响包围盒」的信号：尺寸变化 / DOM 增删 / 样式类变化。 */
  onChanged: () => void;
}

export interface LayoutWatchHandle {
  dispose(): void;
}

export function watchLayout(options: LayoutWatchOptions): LayoutWatchHandle {
  const { resolveRoot, onChanged } = options;

  let disposed = false;
  let root: Element | null = null;
  let pollTimer: number | undefined;
  let lastSignalAt = performance.now();
  /** 已挂上 ResizeObserver 的元素；重复 observe 不报错，但会白占一份引用 */
  const watched = new WeakSet<Element>();

  const signal = (): void => {
    if (disposed) return;
    lastSignalAt = performance.now();
    onChanged();
  };

  /* 尺寸变化直接送到 onChanged：过渡态逐帧变宽变窄时每帧都要重量，
     否则会出现「内容已经长出来了，窗口还卡在旧宽度」。 */
  const resize = new ResizeObserver(() => signal());

  const observeTree = (el: Element): void => {
    if (watched.has(el)) return;
    watched.add(el);
    resize.observe(el);
    for (const child of Array.from(el.children)) observeTree(child);
  };

  const unobserveTree = (el: Element): void => {
    if (watched.has(el)) {
      resize.unobserve(el);
      watched.delete(el);
    }
    for (const child of Array.from(el.children)) unobserveTree(child);
  };

  /**
   * 确保根被观察。`.layer` 是首帧渲染出来的，effect 跑的时候可能还没有；
   * 所以这里不缓存失败，每次信号都重试一次（代价是一次 querySelector）。
   */
  const ensureRoot = (): void => {
    if (root?.isConnected) return;
    root = resolveRoot();
    if (root) observeTree(root);
  };

  const mutation = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== 'childList') continue;
      /* 增量挂载：新节点自带整棵子树，不用断开重连整棵树
         （全量 disconnect/observe 会把「已观察过」的信息丢光，每次增删都要重走一遍）。 */
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement) observeTree(node);
      }
      for (const node of Array.from(record.removedNodes)) {
        if (node instanceof HTMLElement) unobserveTree(node);
      }
    }
    ensureRoot();
    signal();
  });
  mutation.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });

  ensureRoot();

  const onInteraction = (): void => {
    /* 只加热、不测量：交互本身不改变已经画出来的矩形，
       但紧接着往往会有一次布局变化，这时候别让兜底轮询还停在低频档。 */
    lastSignalAt = performance.now();
  };
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, onInteraction, { passive: true });
  }

  const nextPollDelay = (): number =>
    performance.now() - lastSignalAt < HOT_WINDOW_MS ? HOT_POLL_MS : COLD_POLL_MS;

  const loop = (): void => {
    if (disposed) return;
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined;
      if (disposed) return;
      /* 这里刻意走 onChanged 而不是 signal：轮询不是「有变化」，它不该给自己加热 */
      onChanged();
      loop();
    }, nextPollDelay());
  };
  loop();

  return {
    dispose() {
      disposed = true;
      resize.disconnect();
      mutation.disconnect();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction);
      }
    },
  };
}
