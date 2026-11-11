// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import dashboard from "./Dashboard.tsx?raw";
import contract from "../layout/contract.ts?raw";

/**
 * [v2 网格 · 0.12.1末] 主界面「板子塌了 / 网格没接对」的回归判据。
 *
 * 历史事故（2026-11-11 实拍）：加卡工具条被放进 `.qp-main-view`，而那个容器当时是
 * `grid-template-rows: minmax(0,1fr) var(--qp-mod-note)` —— 正好两行的模板。多出来的
 * 工具条先吃掉 1fr 行，双列区被压到 56px，卡片互相重叠、便利贴压在环卡上。
 *
 * v2 把「双列 + 列宽分隔条 + 每卡四等分」整体换成「4 列单网格 + x/w 定位」。这些判据
 * 守的是 v2 下同样「改回去零报错、只会某天被报『拖不动 / 显示不全』」的接线：
 *  ① 工具条必须是板子的**兄弟**，不许进板子；
 *  ② 网格必须是 4 列、行高走基准令牌、`dense` 自动补位；
 *  ③ 卡定位必须由 CardSlot 写 inline `grid-column`/`grid-row`，不是靠行模板猜。
 *
 * **（板子必须是 flex 列）没有自动判据**：Vite 对 `.css?raw` 也走 CSS 管线，
 * 拿不到原文（试过，`indexOf(".qp-main-view {")` 返回 -1）。那条只能靠人看
 * `dashboard.css` 的 `.qp-main-view` 一节，注释已写明不许退回两行网格。
 *
 * 用 `?raw` 而不是 `readFileSync`：jsdom 里 `import.meta.url` 是 http 形态，
 * `new URL(rel, import.meta.url)` 会抛「The URL must be of scheme file」。
 */
describe("主界面板子结构（网格 v2）", () => {
  it("p01a_add_card_toolbar_is_a_sibling_of_the_board_not_a_child", () => {
    const toolbar = (dashboard as string).indexOf("qp-dashboard-toolbar");
    const board = (dashboard as string).indexOf('className="qp-main-view"');
    expect(toolbar).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(-1);
    expect(toolbar).toBeLessThan(board);
  });

  it("p01b_grid_is_4_columns_dense_flow_and_row_height_from_a_token", () => {
    /* 行高不再由 `grid-template-rows` 给：网格是 4 列、`dense` 自动向上补位，
     * 行高 = 基准行高令牌 `--qp-grid-row`（= 计时分布卡 264）。这三样断一处，
     * 表现是「卡片错位 / 有空洞 / 高塌成内容」，零报错。 */
    const grid = cssBlock(readCss("../../../app/styles/features/dashboard.css"), ".qp-grid");
    expect(grid).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(grid).toContain("grid-auto-rows: var(--qp-grid-row)");
    expect(grid).toContain("grid-auto-flow: dense");
    /* 基准行高令牌必须在 tiers.css 有定义，否则行高回退 auto → 卡片塌成内容高。 */
    expect(readCss("../../../app/styles/tiers.css")).toContain("--qp-grid-row: 264px");
  });

  it("p01c_card_slot_writes_inline_grid_position_not_a_row_template", () => {
    /* 卡定位由 CardSlot 写 inline `grid-column: x+1 / span w` + `grid-row: span h`。
     * 槽的 CSS 兜底是「占 1 格」：若 CardSlot 漏写 inline 样式，所有卡都会挤到
     * 第一列一列（实测 107 而不是 466），代码里看不出错在哪。 */
    const slot = cssBlock(readCss("../../../app/styles/features/dashboard-split.css"), ".qp-card-slot");
    expect(slot).toContain("grid-column: span 1");
    expect(slot).toContain("grid-row: span 1");
    /* 槽必须有相对定位，宽度手柄才锚得上（拖宽没反应的经典成因）。 */
    expect(slot).toContain("position: relative");
  });
});

/** [0.12.1 修复] 手柄与占位的两条结构判据（同一份事故的两个面）。 */
describe("拖拽手柄与未实现卡", () => {
  it("p02b_unimplemented_cards_never_render_null", async () => {
    const shell = (await import("./ModuleShell.tsx?raw")).default as string;
    expect(shell).toContain("qp-card-resize");
    /* 卡渲染已从 `Dashboard.tsx` 拆到 `DashboardCards.tsx`；哨兵跟着搬，念的是
     * 「卡渲染这一层」而不是某个具体文件名 —— 再拆一次只需把新文件加进这张表。 */
    const board = await Promise.all([
      import("./Dashboard.tsx?raw"),
      import("./DashboardCards.tsx?raw"),
    ]).then((mods) => mods.map((mod) => mod.default as string).join("\n"));
    /* 渲染未实现卡时必须落到占位卡，不许 return null（null = 用户点了添加什么都没有） */
    expect(board).toContain("CardPlaceholder");
  });
});

/** [v2 网格] 卡位在槽上、网格定位接线到布局模型（改回去只会「拖不动」，零报错）。 */
describe("网格定位接线", () => {
  it("p03a_card_slot_reads_x_w_h_from_the_layout_card", async () => {
    const slotSrc = (await import("../layout/CardSlot.tsx?raw")).default as string;
    /* grid-column 由 `card.x`/`card.w` 算出来，不是写死 */
    expect(slotSrc).toContain("card.x + 1");
    expect(slotSrc).toContain("span ${card.w}");
    /* grid-row 由 `card.h` 算出来 */
    expect(slotSrc).toContain("span ${card.h}");
  });

  it("p03b_dashboard_renders_cards_from_the_layout_model", async () => {
    const board = (await import("./Dashboard.tsx?raw")).default as string;
    /* 网格里渲染的是 `layout.layout.cards`，不是写死的五张卡 */
    expect(board).toContain("renderCards(layout.layout.cards)");
    expect(board).toContain('className="qp-grid"');
  });
});

/**
 * [自由调大小 · 0.12.1] 「高度拖不动 / 卡片显示不完全」的结构判据（v2 仍有效）。
 *
 * 事故形状：板高写死 636 且视图根 `overflow: hidden`，于是拖高只能把同列另一张压扁。
 * 这两条**改回去不会报任何错**，只会某天又被报"显示不全"，所以钉在这里。
 *
 * `?raw` 读不了 CSS（Vite 会走 CSS 管线，见文件头），所以样式判据用 `readFileSync`。
 */
function cssBlock(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `样式里找不到 ${selector}`).toBeGreaterThan(-1);
  const end = css.indexOf("}", at);
  return css.slice(at, end + 1);
}

function readCss(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("自由调大小", () => {
  it("p04a_view_root_scrolls_and_board_uses_min_height", () => {
    const css = readCss("../../../app/styles/features/dashboard.css");
    const root = cssBlock(css, ".qp-dashboard");
    /* 视图根必须能纵向滚：这是"卡片变高有去处"的唯一出口 */
    expect(root).toContain("overflow-y: auto");
    expect(root).not.toContain("overflow: hidden");

    const board = cssBlock(css, ".qp-main-view");
    /* 板高是**下限**不是定值：默认内容恰好等于它（几何不动），拖高后跟着长 */
    expect(board).toContain("min-height: min(var(--qp-board-h)");
    /* 不许再有定值 height（`min-height` 里也含这个子串，所以按"整行是不是 height"判） */
    const boardLines = board.split("\n").map((line) => line.trim());
    expect(boardLines.some((line) => line.startsWith("height:"))).toBe(false);
  });

  it("p04b_toolbar_floats_instead_of_taking_document_flow", () => {
    const css = readCss("../../../app/styles/features/dashboard.css")
      + readCss("../../../app/styles/features/dashboard-layout.css");
    const toolbar = cssBlock(css, ".qp-dashboard-toolbar");
    /* 绝对定位：占文档流的话它吃掉 20px + gap 8，板子仍按 636 算，底部被裁 */
    expect(toolbar).toContain("position: absolute");
    /* 不再靠 flex 行内对齐占位：绝对定位后垂直位置由 top 决定 */
    expect(toolbar).not.toContain("justify-content: flex-end");
  });

  it("p04d_board_never_shrinks_so_height_has_somewhere_to_go", () => {
    const css = readCss("../../../app/styles/features/dashboard.css");
    /* 板子是 `.qp-dashboard` 的 flex 子项，默认 `flex: 0 1 auto` 会被压回 636：
     * 内容 840 也没用。实测加这一行前卡片恒 282、加之后 480。 */
    expect(cssBlock(css, ".qp-main-view")).toContain("flex: 0 0 auto");
  });
});

/** [两张真卡 · 0.12.1] 占位换成真组件后，别再退回 `CardPlaceholder`。 */
describe("应用趋势 / 提醒窗口", () => {
  it("p05a_both_cards_dispatch_to_real_components", async () => {
    const cards = (await import("./DashboardCards.tsx?raw")).default as string;
    expect(cards).toContain("<TrendModule");
    expect(cards).toContain("<ReminderModule");
    /* 两张卡都得在"能渲染"名单里，否则加卡弹层永远不列它们（上一版的空洞） */
    const c = contract as string;
    const start = c.indexOf("IMPLEMENTED_CARDS");
    expect(c.slice(start, start + 220)).toContain("trend");
    expect(c.slice(start, start + 220)).toContain("reminder");
  });
});
