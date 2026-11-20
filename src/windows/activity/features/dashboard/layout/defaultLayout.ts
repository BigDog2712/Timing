/**
 * [v3] 出厂布局 = **主人在 2026-11-20 摆定的那一版主界面**（原 exe 首屏版下线）。
 *
 * 这一版不是重新"设计"的，而是把当时主界面上的排布原样抄成常量 —— 主人明确要求
 * 「当前主界面布局就是未来应用的起始布局」，所以从此以后：
 *   · 首次安装（没有任何布局键）→ 这一版；
 *   · 删掉当前布局 / 坏存档回落 / 布局管理里的「出厂布局」→ 也是这一版。
 *
 * 画布仍然是 1250 宽的设计点，三列不再是等宽栅格：
 *
 *   col1 x=24  : timer    (328×304)  → timeline (328×424)
 *   col2 x=360 : apps     (328×304)  → manage   (328×424)
 *   col3 x=696 : heatmap  (536×248)  → trend    (536×192) → notes (320×280)
 *   bottom     : reminder (330×304, x=0 / y=776)
 *
 * `w/h` 是主人拖出来的尺寸，不再等于 `KIND_SPECS[kind].sizes.M`（例如 timer 328 而非
 * 340）；`clampRect` 只保证不越界、不小于 min，不会把它们改回去。
 */
import { LAYOUT_VERSION, type DashboardLayout } from "./contract";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: LAYOUT_VERSION,
  /* 最大 uid = 8 → 下一个可用号 = 9（`normalizeLayout` 也按 max(uid)+1 重算，同口径） */
  nextId: 9,
  snap: true,
  cards: [
    { uid: 1, kind: "timer", x: 24, y: 24, w: 328, h: 304, tier: "M" },
    { uid: 4, kind: "timeline", x: 24, y: 344, w: 328, h: 424, tier: "M" },
    { uid: 2, kind: "apps", x: 360, y: 24, w: 328, h: 304, tier: "M" },
    { uid: 5, kind: "manage", x: 360, y: 344, w: 328, h: 424, tier: "M" },
    { uid: 6, kind: "heatmap", x: 696, y: 24, w: 536, h: 248, tier: "M" },
    { uid: 3, kind: "trend", x: 696, y: 280, w: 536, h: 192, tier: "M" },
    { uid: 7, kind: "notes", x: 696, y: 488, w: 320, h: 280, tier: "M" },
    { uid: 8, kind: "reminder", x: 0, y: 776, w: 330, h: 304, tier: "M" },
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
