// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
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

  it("p01c_column_cards_take_their_height_from_the_slot_not_from_a_grid_row", () => {
    /* [单独宽度] 行高不再由 `grid-template-rows` 给：列内卡可以并排，一行里两张卡
     * 共享轨道会互相压。定高改落在槽上，令牌名仍是 `--qp-mod-*`（数值没动，像素验收不变）。
     * 这张令牌表少一条 → 那张卡塌成内容高度，且**没有任何报错**。 */
    const css = readCss("../../../app/styles/features/dashboard-split.css");
    expect(cssBlock(css, ".qp-card-slot")).toContain("height: var(--qp-slot-h)");
    /* 兜底占满整列：槽没带内联 `span N` 时只占 1 格（实测 107 而不是 466），
     * 症状是「列变窄、右边空一片」，代码里看不出错在哪。 */
    expect(cssBlock(css, ".qp-card-slot")).toContain("grid-column: span 4");
    for (const id of ["timer", "items", "apps", "todos"]) {
      expect(css).toContain(`.qp-card-slot[data-card="${id}"] { --qp-slot-h: var(--qp-mod-${id}); }`);
      for (const tier of ["s", "l"]) {
        expect(css).toContain(
          `.qp-card-slot[data-card="${id}"][data-tier="${tier.toUpperCase()}"] { --qp-slot-h: var(--qp-mod-${id}-${tier}); }`,
        );
      }
    }
    /* 格数必须与 `contract.ts` 的 `CARD_WIDTH_TRACKS`（4）对上：只改一边，
     * 半宽的卡会溢出到隐式列上 —— 跑出列外、把整块板撑宽。 */
    expect(readCss("../../../app/styles/features/dashboard.css")).toContain("repeat(4, minmax(0, 1fr))");
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

/** [列宽比可拖 · 0.12.1] 分隔条必须**接在板子上**，不是画一条装饰线。 */
describe("列宽分隔条", () => {
  it("p03a_split_handle_drags_the_board_and_board_reads_split", async () => {
    const board = (await import("./Dashboard.tsx?raw")).default as string;
    /* ① 分隔条存在且可聚焦（键盘 ←/→ 走同一条路径） */
    expect(board).toContain('className="qp-split"');
    expect(board).toContain("aria-valuenow={split}");
    /* ② 指针落在它上面才开始拖 —— 只渲染不挂 handler 的话，拖它毫无反应 */
    expect(board).toContain("onPointerDown={splitResize.onPointerDown}");
    /* ③ 比例必须真的写进列模板；只存进 localStorage 不改样式 = 拖了没变化 */
    expect(board).toContain("gridTemplateColumns");
    expect(board).toContain("SPLIT_TOTAL - split");
  });
});

/**
 * [自由调大小 · 0.12.1] 「高度拖不动 / 卡片显示不完全」的结构判据。
 *
 * 事故形状：板高写死 636 且视图根 `overflow: hidden`，于是
 *   ① 列内卡拖高只会把同列另一张压扁（总高不变，看着像"拖不动"）；
 *   ② 通栏卡拖高直接溢出被裁；工具条还占 28px，把底部便利贴切掉一半。
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

  it("p04d_board_and_columns_never_shrink_so_height_has_somewhere_to_go", () => {
    const css = readCss("../../../app/styles/features/dashboard.css");
    /* 板子是 `.qp-dashboard` 的 flex 子项，默认 `flex: 0 1 auto` 会被压回 636：
     * 内容 840 也没用。实测加这一行前卡片恒 282、加之后 480。 */
    expect(cssBlock(css, ".qp-main-view")).toContain("flex: 0 0 auto");
    /* 双列区必须「只许长不许缩」。`1 1 auto` 会把 grid 行一起压扁（shrink 到 min-height:0），
     * 于是行高被算回容器高 —— 这是「拖不动」的第二道锁。 */
    const ws = cssBlock(css, ".qp-ws");
    expect(ws).toContain("flex: 1 0 auto");
    expect(ws).not.toContain("flex: 1 1 auto");
  });

  it("p04c_full_slot_tokens_cover_the_two_new_cards", () => {
    const css = readCss("../../../app/styles/features/dashboard-split.css");
    /* 趋势柱高是百分比：槽没有定高时父级高度为 auto，七根柱会全部塌成 0（"卡是空的"） */
    expect(css).toContain('.qp-full-slot[data-card="trend"]');
    expect(css).toContain('.qp-full-slot[data-card="reminder"]');
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
