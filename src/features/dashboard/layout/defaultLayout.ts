/**
 * [v2 · 0.12.1末] 默认布局 = **网格排布**。
 *
 * 4 列网格、基准行高 264。默认 5 张卡：
 *   · timer      x0 w2（半宽，计时分布）
 *   · apps       x2 w2（半宽，应用排行）
 *   · items      x0 w2（半宽，事项分布）
 *   · todos      x2 w2 h2（右半，占两行 —— 内容多）
 *   · notes      x0 w4（通栏，便利贴）
 * 流式排布下自动补位：timer/apps 在第一行，items 接第二行左、todos 占第二三行右，
 * notes 通栏落最后。
 */
import type { DashboardLayout } from "./contract";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 2,
  cards: [
    { id: "timer", x: 0, w: 2, h: 1, tier: "M" },
    { id: "apps", x: 2, w: 2, h: 1, tier: "M" },
    { id: "items", x: 0, w: 2, h: 1, tier: "M" },
    { id: "todos", x: 2, w: 2, h: 2, tier: "M" },
    { id: "notes", x: 0, w: 4, h: 1, tier: "M" },
  ],
};
