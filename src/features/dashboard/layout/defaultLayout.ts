/**
 * [P1 · 0.12.1] 默认布局 = **今天的画面**。
 *
 * 这张表的唯一职责：生成的 CSS 行序与今天 `.qp-col-left/right` 里那两条硬编码逐字相同
 * （left: `--qp-mod-timer --qp-mod-items`，right: `--qp-mod-apps --qp-mod-todos`），
 * 通栏只有便利贴。任何一个数组顺序被改，B1 的四个行高就会错位 —— 所以顺序本身是判据。
 */
import type { DashboardLayout } from "./contract";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  cards: [
    { id: "timer", column: "left", tier: "M" },
    { id: "items", column: "left", tier: "M" },
    { id: "apps", column: "right", tier: "M" },
    { id: "todos", column: "right", tier: "M" },
    { id: "notes", column: "full", tier: "M" },
  ],
};
