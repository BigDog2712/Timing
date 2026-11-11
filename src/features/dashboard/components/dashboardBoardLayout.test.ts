import { describe, expect, it } from "vitest";
import dashboard from "./Dashboard.tsx?raw";
import contract from "../layout/contract.ts?raw";

/**
 * [P1 修复回填 · 0.12.1] 主界面「板子塌了」的回归判据。
 *
 * 事故形状（2026-11-11 实拍）：加卡工具条被放进 `.qp-main-view`，而那个容器当时是
 * `grid-template-rows: minmax(0,1fr) var(--qp-mod-note)` —— 正好两行的模板。多出来的
 * 工具条先吃掉 1fr 行，双列区被压到 56px，卡片互相重叠、便利贴压在环卡上。
 *
 * 三条判据各守一半：
 *  ① 结构：工具条必须是板子的**兄弟**，不许进板子；
 *  ② 行高：必须被 `minmax(0, …)` 夹住，否则空间不足时溢出列去压下一张卡。
 *
 * **②（板子必须是 flex 列）没有自动判据**：Vite 对 `.css?raw` 也走 CSS 管线，
 * 拿不到原文（试过，`indexOf(".qp-main-view {")` 返回 -1）。那条只能靠人看
 * `dashboard.css` 的 `.qp-main-view` 一节，注释已写明不许退回两行网格。
 *
 * 用 `?raw` 而不是 `readFileSync`：jsdom 里 `import.meta.url` 是 http 形态，
 * `new URL(rel, import.meta.url)` 会抛「The URL must be of scheme file」。
 */
describe("主界面板子结构", () => {
  it("p01a_add_card_toolbar_is_a_sibling_of_the_board_not_a_child", () => {
    const toolbar = (dashboard as string).indexOf("qp-dashboard-toolbar");
    const board = (dashboard as string).indexOf('className="qp-main-view"');
    expect(toolbar).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(-1);
    expect(toolbar).toBeLessThan(board);
  });

  it("p01c_column_rows_are_clamped_so_they_shrink_instead_of_overlapping", () => {
    expect(contract as string).toContain("minmax(0, var(");
  });
});
