/**
 * Timing — 拖拽态（跨组件共享的唯一一份）
 * -----------------------------------------------------------------------------
 * 为什么要有这个文件：`usePillDrag` 的拖拽态原本是组件内部的 ref（`origin` / `swallow`），
 * 而「圆点 / 药丸」各有一份 hook 实例、`entry/App.tsx` 看不见它们。但有一条判定在 App 层：
 * 「托盘双击高亮要不要把圆点临时展开成条」——**拖动窗口的过程中不许改窗口尺寸**，
 * 所以 App 需要读到「此刻是否在拖」，而这份状态只能放在 hooks 之外。
 *
 * 置位时机：`usePillDrag` 越过 4px 阈值、真正开始原生拖窗那一刻（与既有的
 * 「拖完吞掉那一次 click」同一个判定点），所以「算不算拖」与点击语义天然一致。
 * 复位时机：`pointerup` / `pointercancel`，外加一个 `DRAG_FLAG_MAX_MS` 的**超时兜底**。
 *
 * 为什么必须有兜底：`startDragging()` 把鼠标交给系统窗口拖动循环，那段期间 WebView
 * 收不到 `pointerup`。没有兜底的话，一次拖动就能把标志永久卡在 true —— 之后所有
 * 高亮都不再展开，属于「一次操作把功能静默打死」的缺陷。兜底取 2s：比任何一次
 * 有意识的拖动短不了太多，卡住最多 2s 就自愈。
 *
 * ## 为什么不放进 zustand（刻意的代价）
 *
 * 这是一个**进程级单例，不进 React 状态**，所以它：
 *   · **不触发渲染**——读到它的只有「高亮那一下」的一次性判定，没有任何 UI 依赖它出画面；
 *   · **不参与组件生命周期**——没有 Provider、不随组件卸载重置，靠上面的超时兜底与
 *     `pointerup` 复位来保证不会脏。
 *
 * 反过来，把 `dragging` 塞进 `uiStore` 的代价是：拖动期间每次 `pointermove` 都 `setState`，
 * 主窗整体跟着重渲染（药丸 / 圆点本来靠 ref 刻意规避这一点）。为一个布尔值付这个钱不值得，
 * 所以选了单例。**新增读者时请注意**：这里不是响应式的，别在渲染里读它。
 */
import { DRAG_FLAG_MAX_MS } from './constants';

/** 是否有拖动正在进行（模块级单例：主窗同一时刻只可能有一个指针在拖） */
let dragActive = false;
/** 超时兜底定时器（原生拖动吃掉 pointerup 时唯一能复位它的东西） */
let backstop: number | null = null;

/**
 * [B4 · P2 §2.3] 把拖动态**镜像**到 `html[data-dragging]`，让 CSS 能在不重渲染的前提下
 * 表达「拖动中把手隐藏」。这与上面「不进 React 状态」的决定一致：属性写的是 DOM，
 * 不触发任何 setState，药丸 / 圆点仍然零重渲染。
 */
function syncDraggingAttr(active: boolean): void {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (!root) return;
  if (active) root.dataset.dragging = 'true';
  else delete root.dataset.dragging;
}

/** 开始拖动：置位 + 重排兜底（重复调用不会叠定时器） */
export function markDragActive(): void {
  dragActive = true;
  syncDraggingAttr(true);
  if (backstop != null) window.clearTimeout(backstop);
  backstop = window.setTimeout(() => {
    backstop = null;
    dragActive = false;
    syncDraggingAttr(false);
  }, DRAG_FLAG_MAX_MS);
}

/** 拖动结束（松手 / 取消 / 被吞掉的那次 click）：立刻复位并撤掉兜底 */
export function markDragIdle(): void {
  if (backstop != null) {
    window.clearTimeout(backstop);
    backstop = null;
  }
  dragActive = false;
  syncDraggingAttr(false);
}

/** 当前是否在拖动（read-only 探针，调用方不要拿它做副作用） */
export function isDragActive(): boolean {
  return dragActive;
}
