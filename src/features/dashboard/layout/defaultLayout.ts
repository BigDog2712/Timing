/**
 * [v3] 出厂布局 = **`timing-board.exe` 首屏那一版**（`layout.rs` 的 `Layout::default` + `pack`）。
 *
 * 排布不是"设计"出来的，而是 exe 的装箱算法跑出来的结果，这里直接写成常量：
 *   三列 x = 24 / 380 / 726，列宽 340 / 330 / 500，列距 16，首行 y = 24，行距 16。
 *   每张卡进"放得下且最靠上"的那一列（exe `pack()` 的判据）。
 *
 *   col1 24 : timer (340×304) → 时间线 (340×424)
 *   col2 380: apps  (330×304) → todos  (330×424)
 *   col3 726: trend (500×304) → heatmap (500×224) → notes (500×184)
 *
 * 与 exe 唯一的差别：exe 那颗「事项菜单」被主人摘掉了（前一轮要求），原来的槽位
 * 340×424 交给「今日时间线」—— 尺寸照抄，所以三列的高度关系与 exe 一模一样。
 */
import { LAYOUT_VERSION, type DashboardLayout } from "./contract";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: LAYOUT_VERSION,
  nextId: 8,
  snap: true,
  cards: [
    { uid: 1, kind: "timer", x: 24, y: 24, w: 340, h: 304, tier: "M" },
    { uid: 2, kind: "apps", x: 380, y: 24, w: 330, h: 304, tier: "M" },
    { uid: 3, kind: "trend", x: 726, y: 24, w: 500, h: 304, tier: "M" },
    { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: "M" },
    { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 424, tier: "M" },
    { uid: 6, kind: "heatmap", x: 726, y: 344, w: 500, h: 224, tier: "M" },
    { uid: 7, kind: "notes", x: 726, y: 584, w: 500, h: 184, tier: "M" },
  ],
};

/**
 * 任意布局的**深拷贝**。
 *
 * `options` 也要拷一层：`setOption` 虽然每次新建对象，但 `reset` / `恢复出厂` 拿到的
 * 是别人手里那份引用，漏拷一层等于让两处共享同一个 options（改一边另一边跟着变）。
 */
export function cloneLayout(source: DashboardLayout): DashboardLayout {
  return {
    ...source,
    cards: source.cards.map((card) => ({
      ...card,
      ...(card.options ? { options: { ...card.options } } : {}),
    })),
  };
}

/**
 * 读**出厂**布局的深拷贝：默认值被 store 改过后不能在下次 reset 时带上改过的痕迹。
 *
 * 注意这里只做出厂那一版 —— 「当前默认布局」可能是主人自己存的那版，
 * 那件事归 `layoutStore.loadDefaultLayout()`（要读 localStorage，纯模块不碰存储）。
 */
export function cloneDefaultLayout(): DashboardLayout {
  return cloneLayout(DEFAULT_LAYOUT);
}
