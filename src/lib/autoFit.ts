/**
 * Timing — 主窗自适应尺寸的纯计算内核（与 DOM / Tauri 完全解耦）
 * -----------------------------------------------------------------------------
 * 为什么单独成文件：`useWindowAutoFit` 里最值钱的是「一堆矩形怎么变成一个窗口矩形」
 * 这段算术——它决定了内容在屏幕上会不会跳位、透明带会不会留在窗口里。
 * 之前它埋在 `useEffect` 的闭包里，只能靠手动拖一遍窗口来验；抽出来后由
 * `autoFit.test.ts` 逐个边界钉死（T15），hook 里只剩「测量 + 调用 + 落地」。
 *
 * 坐标系约定（很关键，写错就会正反馈抖动）：
 *   传入的 `Edges` 一律是**布局坐标**（= `.layer` 的固定坐标系，原点在胶囊左上角），
 *   而不是 `getBoundingClientRect()` 的视口坐标。换算（视口 + 平移量 + 滚动量）
 *   留在 hook 里做，因为那部分依赖运行时状态。
 *
 * [ADR-020] 不再有「画布」：调用方传入的 `BoundsSize` 是**布局上界**——主窗取胶囊所在
 * 显示器的工作区（Rust `main_work_area`），非主窗取真实视口。上界只用于「内容再大也
 * 不撑出屏幕」，不再是一个写死的 384×360 常量。
 */

/** 一块内容在布局坐标系下的四条边 */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 布局上界（DIP）。主窗 = 显示器工作区；非主窗 = 真实视口。
 *
 * `x` / `y` 是上界左上角的**布局坐标**（层坐标），可省略（= 0）。主窗贴着屏幕中段时
 * 它是负数——工作区左上角本来就落在胶囊左上角的左上方。
 *
 * [V0.3.1] 以前这里只有尺寸，`computeFitBox` 便把窗口原点硬钳在 0，于是窗口只能向右下
 * 生长、浮层永远长不到胶囊上方：菜单「下方放不下就翻到上方」在屏幕下半边必然失败
 * （上半截内容被窗口上边缘裁掉）。补上原点后，窗口原点可以为负，翻上去 = 窗口向上长。
 */
export interface BoundsSize {
  x?: number;
  y?: number;
  w: number;
  h: number;
}

/** 窗口原点对应的布局坐标 + 当前窗口尺寸（DIP） */
export interface FitBox {
  l: number;
  t: number;
  w: number;
  h: number;
}

export interface FitThresholds {
  /**
   * 窗口在包围盒外每边留的余量。
   *
   * [V0.3.1] 默认 0：原来留 3px 是为了给「胶囊圆角 + 描边」留位置，实际两条都不成立——
   * `getBoundingClientRect()` 量的是 **border-box 外接矩形**，圆角与 1px 描边都在矩形**内侧**，
   * 窗口贴死矩形也不会切掉任何一笔；而 `--shadow-balloon` 在明暗两套主题里都是 `none`，
   * 更不需要外扩。留 3px 的唯一效果就是小条四周多一圈「看不见但吃点击、并且能在窗口边缘
   * 显出一条淡边」的空白，用户口径：不要那圈边。
   */
  pad: number;
  /** 尺寸变化小于它就不动窗口，避免 1px 抖动导致窗口来回抽搐 */
  minSizeDelta: number;
  /** 位移阈值更严：哪怕 1px 也要补正，否则四周会留一条透明缝 */
  minPosDelta: number;
}

export const DEFAULT_FIT_THRESHOLDS: FitThresholds = {
  pad: 0,
  minSizeDelta: 2,
  minPosDelta: 1,
};

/** 裁决结果：新的窗口几何 + 「要不要真的去调窗口」 */
export interface FitDecision {
  box: FitBox;
  sizeChanged: boolean;
  posChanged: boolean;
  /** 需要平移的窗口位移（DIP），posChanged 为 false 时应为 0,0 */
  dx: number;
  dy: number;
}

/**
 * 元素是否「真的画出来了」。
 *
 * 只做判定，不碰 DOM：把 `getComputedStyle()` 的结果与 rect 尺寸喂进来即可，
 * 这样悬空态（display:none / visibility:hidden / opacity:0 / 0×0）在单测里能直接枚举。
 */
export function isRendered(
  style: { display?: string; visibility?: string; opacity?: string },
  rect?: { width: number; height: number },
): boolean {
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number.parseFloat(style.opacity ?? '1') <= 0.01) return false;
  if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
  return true;
}

/**
 * 多块矩形取并集。空集合 → `null`（调用方据此跳过这一轮）。
 *
 * 退化值（宽或高为 0、NaN、Infinity）一律被丢弃，否则一个 0×0 的幽灵节点
 * 就会把 left/top 拉到 0，窗口被撑回整个屏幕。
 */
export function unionEdges(rects: readonly Edges[]): Edges | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const r of rects) {
    if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) continue;
    if (!Number.isFinite(r.right) || !Number.isFinite(r.bottom)) continue;
    if (r.right <= r.left || r.bottom <= r.top) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (right <= 0 || bottom <= 0) return null;
  return { left, top, right, bottom };
}

/**
 * 由布局坐标包围盒裁决出窗口几何。
 *
 * 规则（按顺序，任何一条改动都会改变「窗口贴不贴内容」的观感）：
 *   1. 原点 = floor(边) - pad，并钳制在 `[上界原点, 上界原点 + 边长 - 1]`——窗口不越出上界；
 *      主窗的上界原点通常是负数，因此原点也可以是负数（浮层向胶囊上方/左方生长时）；
 *   2. 尺寸 = ceil(对边) + pad - 原点，且至少 1×1；上界（主窗 = 显示器工作区）
 *      是**上限**（内容再大也不撑出屏幕）；
 *   3. 与上一轮比较：尺寸差 >= minSizeDelta 才算「要改尺寸」，
 *      位移差 >= minPosDelta 才算「要挪位置」；两者皆否 → 返回 `null`（这轮什么都不做）。
 *
 * @param prev 上一轮落定的几何。首轮用 `{ l: 0, t: 0, w: 0, h: 0 }`，尺寸差必然超标，
 *             因此一定会走一次 setSize——这是「窗口先小后大」那一拍的来源，属预期行为。
 */
export function computeFitBox(
  edges: Edges | null,
  bounds: BoundsSize,
  prev: FitBox,
  thresholds: FitThresholds = DEFAULT_FIT_THRESHOLDS,
): FitDecision | null {
  if (!edges) return null;
  const { pad, minSizeDelta, minPosDelta } = thresholds;
  if (bounds.w <= 0 || bounds.h <= 0) return null;

  const bx = bounds.x ?? 0;
  const by = bounds.y ?? 0;
  const x = Math.max(bx, Math.min(bx + bounds.w - 1, Math.floor(edges.left) - pad));
  const y = Math.max(by, Math.min(by + bounds.h - 1, Math.floor(edges.top) - pad));
  const w = Math.max(1, Math.min(bx + bounds.w - x, Math.ceil(edges.right) + pad - x));
  const h = Math.max(1, Math.min(by + bounds.h - y, Math.ceil(edges.bottom) + pad - y));
  if (w <= 0 || h <= 0) return null;

  const sizeChanged = Math.abs(w - prev.w) >= minSizeDelta || Math.abs(h - prev.h) >= minSizeDelta;
  const dx = x - prev.l;
  const dy = y - prev.t;
  const posChanged = Math.abs(dx) >= minPosDelta || Math.abs(dy) >= minPosDelta;
  if (!sizeChanged && !posChanged) return null;

  return { box: { l: x, t: y, w, h }, sizeChanged, posChanged, dx, dy };
}

/**
 * 把某元素的视口坐标换算成布局坐标。
 *
 * 两个加项都不能省：
 *   - `offset`：`.layer` 被 translate(-l,-t) 整体挪过，量到的 rect 天然少了一次平移；
 *   - `scroll`：万一视口被程序化滚动过（focus / scrollIntoView），rect 也随之偏移。
 * 漏掉任何一个都会形成正反馈：缩一次 → 量到更小的 L → 再缩 → 内容飞出窗口。
 */
export function toLayerRect(
  rect: { left: number; top: number; right: number; bottom: number },
  offset: { l: number; t: number },
  scroll: { x: number; y: number },
): Edges {
  const baseX = offset.l + scroll.x;
  const baseY = offset.t + scroll.y;
  return {
    left: rect.left + baseX,
    top: rect.top + baseY,
    right: rect.right + baseX,
    bottom: rect.bottom + baseY,
  };
}
