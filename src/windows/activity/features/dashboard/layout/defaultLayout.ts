/**
 * [v3] 出厂布局 = **`timing-board.exe` 首屏那一版**（`layout.rs` 的 `Layout::default` + `pack`）。
 *
 * 排布不是"设计"出来的，而是 exe 的装箱算法跑出来的结果，这里直接写成常量：
 *   三列 x = 24 / 380 / 726，列宽 340 / 330 / 500，列距 16，首行 y = 24，行距 16。
 *   每张卡进"放得下且最靠上"的那一列（exe `pack()` 的判据）。
 *
 *   col1 24 : timer (340×304) → items (340×424)
 *   col2 380: apps  (330×304)
 *   col3 726: trend (500×304) → heatmap (500×224) → notes (500×184)
 *
 * [0.12.6] 「待办事项」并进「今日时间线」卡（上区待办 / 下区记录），并新增一张独立的
 * 「事项管理」卡：两张卡正好占住原来的两个槽位 —— 时间线在左列第二行 24/344/340/424，
 * 事项管理在中列第二行 380/344/330/304。
 */
import { LAYOUT_VERSION, type DashboardLayout } from "./contract";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: LAYOUT_VERSION,
  /* 出厂最大 uid = 7 → 下一个可用号 = 8（`normalizeLayout` 也按 max(uid)+1 重算，同口径） */
  nextId: 8,
  snap: true,
  cards: [
    { uid: 1, kind: "timer", x: 24, y: 24, w: 340, h: 304, tier: "M" },
    { uid: 2, kind: "apps", x: 380, y: 24, w: 330, h: 304, tier: "M" },
    { uid: 3, kind: "trend", x: 726, y: 24, w: 500, h: 304, tier: "M" },
    { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: "M" },
    { uid: 5, kind: "manage", x: 380, y: 344, w: 330, h: 304, tier: "M" },
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
