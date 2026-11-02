/**
 * TickBar — auto-fit 的布局上界（ADR-020：删掉主窗固定 384×360 画布）
 * -----------------------------------------------------------------------------
 * 旧模型：主窗在 CSS 里是一张写死的 384×360 画布（`--window-w` / `--window-h`），
 * 浮层坐标与贴边钳制都按这张画布算，真实 OS 窗口再收缩到「可见内容包围盒」。
 *
 * 新模型：**没有画布**。主窗 = 胶囊本身，浮层用绝对定位向外长，auto-fit 把真实窗口
 * 撑到「胶囊 + 浮层」的包围盒。于是「浮层最大能占多少」不再是一个常量，而是**胶囊所在
 * 显示器的工作区**——由 Rust `main_work_area` 命令给出（DIP，与 setSize/setPosition 同口径）。
 *
 * 非主窗（settings / todos / timer / note-*）本来就是正常窗口：上界 = 真实视口。
 *
 * 兜底：读不到工作区时回落 `window.innerWidth/Height`（等于退回「按当前窗口算」，也就是
 * 旧 K-15 的坑）。只在 IPC 不可用或浏览器 mock 时短暂发生，`reclamp_main` 仍是出屏兜底。
 */

import { ipc } from '../services/ipc';
import { getCurrentWindow } from './window';
import type { BoundsSize } from './autoFit';

/**
 * 布局上界（DIP），**已经换算到层坐标**：`x`/`y` 是工作区左上角相对主窗左上角的偏移，
 * 通常是 0 或负数（窗口贴在屏幕中段时就是负的）。
 *
 * 这样 `x + w` / `y + h` 就是「层里最右 / 最下能放到的位置」，贴边钳制可以写成
 * `Math.min(anchor, bounds.x + bounds.w - size.w - EDGE)`，不必再单独知道窗口屏幕位置。
 */
export interface FitBounds extends BoundsSize {
  x: number;
  y: number;
}

let cached: FitBounds | null = null;
let inFlight: Promise<FitBounds> | null = null;

/** 主窗左上角的屏幕逻辑坐标；`refreshFitBounds` 时刷新，用来把工作区换算成层坐标。 */
let origin = { x: 0, y: 0 };

/** `.layer` 当前的 translate 量（= 窗口原点在布局坐标里的位置），由 auto-fit 每次落地时同步。 */
let layerOffset = { l: 0, t: 0 };

/** auto-fit 平移置层后登记偏移，供 {@link clientToLayer} 把指针坐标换回布局坐标。 */
export function setLayerOffset(l: number, t: number): void {
  layerOffset = { l, t };
}

/**
 * 指针事件的 `clientX/clientY`（视口坐标）→ **布局坐标**。
 *
 * 菜单的 `anchor` 是给绝对定位在 `.layer` 里的元素用的，而 `.layer` 被 translate(-l,-t)
 * 整体挪过，直接把 client 坐标当锚点会让菜单稳定地偏左上 (l,t) —— 实测闲置态是 (6,16)。
 * 所有「在光标处弹出」的入口都该走这里；非主窗（设置 / 事项）没有平移，换算即恒等。
 */
export function clientToLayer(x: number, y: number): { x: number; y: number } {
  return { x: x + layerOffset.l, y: y + layerOffset.t };
}

/** 主窗 = 窗口 label `main`（其余窗口沿用真实视口排版）。 */
export function isMainWindow(): boolean {
  return document.documentElement.dataset.window === 'main';
}

/** 同步读上界：主窗且已刷新过 → 显示器工作区；其余 → 真实视口。 */
export function fitBounds(): FitBounds {
  if (isMainWindow() && cached) return cached;
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

/**
 * 拉一次工作区并缓存，同时把上界写进 CSS 变量（`--fit-w` / `--fit-h`，供限高使用）。
 *
 * 初始化与「窗口换显示器 / DPI 变化」时调用；测量主流程仍走同步的 {@link fitBounds}。
 * 并发调用会合并成一次 IPC（`onMoved` 在拖动时可能连发十几下），拿到相同结果时不重写 CSS 变量。
 */
export function refreshFitBounds(): Promise<FitBounds> {
  if (!isMainWindow()) return Promise.resolve(fitBounds());
  if (inFlight) return inFlight;
  inFlight = load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** 真正干活的部分：取工作区 + 窗口原点，换算成层坐标。 */
async function load(): Promise<FitBounds> {
  try {
    const [area, pos] = await Promise.all([ipc.mainWorkArea(), readOrigin()]);
    if (!(area.w > 0) || !(area.h > 0)) return fitBounds();
    origin = pos ?? origin;
    const next: FitBounds = {
      x: area.x - origin.x,
      y: area.y - origin.y,
      w: area.w,
      h: area.h,
    };
    if (!cached || cached.x !== next.x || cached.y !== next.y || cached.w !== next.w || cached.h !== next.h) {
      cached = next;
      applyFitVars(cached);
    }
    return cached;
  } catch {
    return fitBounds();
  }
}

/**
 * 读主窗左上角的屏幕逻辑坐标。
 *
 * 缩放直接用 `devicePixelRatio`（同步，与 WebView 合成器同一口径），比
 * `win.scaleFactor()` 少一次 IPC —— 拖动时节流后仍会连发，省下的就是每次刷新的一半开销。
 * 物理像素 ÷ 缩放后取整，避免亚像素造成的 `onMoved` 抖动；读不到就返回 null 保留旧值。
 */
async function readOrigin(): Promise<{ x: number; y: number } | null> {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const scale = window.devicePixelRatio || 1;
    if (!(scale > 0)) return null;
    return { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale) };
  } catch {
    return null;
  }
}

/**
 * 把上界写成 CSS 变量；令牌里有 100vw / 100vh 兜底值，这里只是覆盖成真实工作区。
 *
 * `floor` 而不是 `round`：物理工作区 ÷ 缩放常常带小数（本机 2560/1.5 = 1706.67），
 * 四舍五入会把布局空间撑出屏幕 0.3px —— 贴右/下边的菜单就会露出半像素白边。
 */
function applyFitVars(bounds: FitBounds): void {
  const root = document.documentElement;
  root.style.setProperty('--fit-w', `${Math.floor(bounds.w)}px`);
  root.style.setProperty('--fit-h', `${Math.floor(bounds.h)}px`);
}
