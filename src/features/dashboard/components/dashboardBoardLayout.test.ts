// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import dashboard from "./Dashboard.tsx?raw";
import boardSource from "../layout/DashboardBoard.tsx?raw";
import canvasSource from "../layout/BoardCanvas.tsx?raw";
import zoomSource from "../layout/useBoardZoom.ts?raw";
import frameSource from "../layout/BoardCardFrame.tsx?raw";
import dragSource from "../layout/useBoardDrag.ts?raw";

/**
 * [v3 自由摆位] 主界面「板子塌了 / 缩放没接对 / 卡拖不动」的回归判据。
 *
 * 守的是四条「改回去零报错、只会某天被报『显示不全 / 拖不动 / 字变小了』」的接线：
 *  ① 主界面渲染的是**板子**（`DashboardBoard`），不是 v2 的 4 列网格；
 *  ② 工具条是板子的**兄弟**且在画布之前（v2 那条事故的同一个形状）；
 *  ③ 缩放必须作用在**整块画布**上（`transform: scale` + 左上原点），不是逐卡重算坐标；
 *  ④ 卡的位置来自布局模型（inline left/top/width/height），不是 CSS 猜的。
 *
 * `?raw` 读不了 CSS（Vite 对 `.css?raw` 也走 CSS 管线），样式判据用 `readFileSync`。
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

describe("主界面组件板结构（v3 自由摆位）", () => {
  it("p01a_dashboard_renders_the_board_not_a_grid", () => {
    expect(dashboard).toContain("<DashboardBoard");
    /* v2 的网格容器彻底下线：留着它就是两套定位在抢同一批卡片 */
    expect(dashboard).not.toContain("qp-grid");
    expect(dashboard).not.toContain("buildGridCards");
  });

  it("p01b_toolbar_is_a_sibling_and_before_the_canvas", () => {
    const toolbar = boardSource.indexOf("qp-dashboard-toolbar");
    const canvas = boardSource.indexOf("<BoardCanvas");
    expect(toolbar).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(-1);
    expect(toolbar).toBeLessThan(canvas);
  });

  it("p01c_zoom_is_user_controlled_and_scales_the_whole_canvas", () => {
    /* [v3.1] 倍率不再跟窗口联动（`fitZoom` 下线）：窗口一变卡片就跟着变大变小，
     * 既看不清细节、又让内容永远刚好铺满（滚轮没东西可滚）。改倍率的入口只有
     * Ctrl + 滚轮 / Ctrl + 加减号，且必须持久化 —— 否则每次开窗都要重调。 */
    expect(canvasSource).not.toContain("fitZoom");
    expect(canvasSource).toContain("useBoardZoom");
    expect(zoomSource).toContain("MIN_ZOOM = 0.5");
    expect(zoomSource).toContain("MAX_ZOOM = 2");
    expect(zoomSource).toContain("ctrlKey");
    /* React 的 onWheel 是 passive 的，拦不住 WebView2 的整页缩放 */
    expect(zoomSource).toContain("passive: false");
    expect(zoomSource).toContain("localStorage");
    expect(canvasSource).toContain("transform: `scale(${zoom})`");

    const css = readCss("../../../app/styles/features/dashboard-board.css");
    /* 原点必须是左上：以中心为原点缩放时，卡片会越缩越往右下漂 */
    expect(cssBlock(css, ".qp-board-canvas")).toContain("transform-origin: top left");
    /* 画布是绝对定位的，尺寸完全由 inline 宽高 + scale 决定 */
    expect(cssBlock(css, ".qp-board-canvas")).toContain("position: absolute");

    /* 滚动归属：画布两个方向都要能滚，否则倍率 > 1 时右边那列看不到 */
    const zoomCss = readCss("../../../app/styles/features/dashboard-board-zoom.css");
    expect(cssBlock(zoomCss, ".qp-board-scroll")).toContain("overflow: auto");
    expect(cssBlock(zoomCss, ".qp-main-view")).toContain("min-height: 0");
  });

  it("p01d_cards_are_positioned_by_the_layout_model", () => {
    expect(frameSource).toContain("left: card.x, top: card.y, width: card.w, height: card.h");
    expect(cssBlock(readCss("../../../app/styles/features/dashboard-board.css"), ".qp-board-card"))
      .toContain("position: absolute");
  });
});

describe("三种抓取（移动 / 改宽 / 改高）", () => {
  it("p02a_three_handles_exist_and_are_keyboard_reachable", () => {
    expect(frameSource).toContain('handle("e"');
    expect(frameSource).toContain('handle("s"');
    expect(frameSource).toContain('handle("se"');
    /* 键盘：只有鼠标一条路的话，键盘用户永远调不动布局 */
    expect(frameSource).toContain("onKeyDown");
    expect(frameSource).toContain("ArrowLeft");
  });

  it("p02b_buttons_inside_a_card_never_start_a_drag", () => {
    /* 卡里有勾选框、输入框、⋯：误判的表现是「点勾选没反应，卡被拖走了」。
     * 判据顺序必须是「先认手柄、再认交互元素、最后才认卡头」。 */
    const interactive = frameSource.indexOf("button, a, input, textarea, select");
    const head = frameSource.indexOf(".qp-card-head, .qp-notes-head, .qp-board-grab");
    expect(interactive).toBeGreaterThan(-1);
    expect(head).toBeGreaterThan(-1);
    expect(interactive).toBeLessThan(head);
  });

  it("p02c_drag_divides_by_zoom_or_it_lags_behind_the_pointer", () => {
    /* 画布缩到 0.7 倍时，不除 zoom 的话指针走 10px 卡只走 7px */
    expect(dragSource).toContain("/ drag.zoom");
    /* 拖动中不落盘：每帧写 localStorage 会把手感拖成卡顿 */
    expect(dragSource).toContain("onPreview");
  });
});

/** 七种组件都必须能分发到真组件，否则加进来的是一个能拖能缩的空框。 */
describe("组件分发", () => {
  it("p05a_all_kinds_dispatch_to_real_components", async () => {
    const cards = (await import("./DashboardCards.tsx?raw")).default as string;
    for (const tag of ["TimerModule", "AppsModule", "TodosModule", "NotesStrip", "TimelineCard", "TrendModule", "HeatmapModule"]) {
      expect(cards, `分发里少了 ${tag}`).toContain(`<${tag}`);
    }
    /* 下线的那两张不许留在分发里：留着就是「能加成空框」 */
    for (const gone of ["ItemsModule", "ReminderModule"]) {
      expect(cards, `${gone} 已下线`).not.toContain(gone);
    }
  });
});

/**
 * 时间线卡的行容器守卫（2026-11-12 · 卡底加了「＋新建 / 编辑」常驻操作条之后）。
 *
 * S 档卡高 200：扣掉卡头与内距 62、再扣掉操作条 47，只剩 91px，而 4 行 × 30 需要 120。
 * 行容器必须**自己滚**，否则第 4 行会被裁在中间 —— 不报错、不告警，看着只是"只有三行半"。
 * 这类"眼睛看得见、测试看不见"的回归最容易在下次改样式时复活，所以钉成断言而不是只写注释。
 */
describe("时间线卡的行容器守卫", () => {
  it("p06a_timeline_rows_scroll_instead_of_clipping", () => {
    const layoutCss = readCss("../../../app/styles/features/dashboard-layout.css");
    const rows = cssBlock(layoutCss, ".qp-card-timeline .qp-timeline-rows");
    expect(rows, "行容器必须纵向可滚（否则 S 档裁半行）").toContain("overflow-y: auto");
    expect(rows, "横向仍要裁：时间线不横向滚动").toContain("overflow-x: hidden");
    /* 行项不许被压扁：列向 flex 子项默认 `flex-shrink: 1`，容器一矮就把 30px 挤成 26/15。
       压扁比裁行更隐蔽（裁口消失了，但行高已经不是 30），所以这条也要钉。 */
    expect(cssBlock(layoutCss, ".qp-timeline-row"), "行高必须固定 30，不许被压缩")
      .toContain("flex: 0 0 auto");
  });
});

/**
 * 待办卡的卡底守卫（2026-11-12 · 卡底加了「＋ 新建待办」footer 之后）。
 *
 * 两类"改回去零报错、只会某天被报『按钮被盖住 / 卡片顶出滚动』"的接线：
 *  ① 撤销条是 absolute，`bottom` 若退回 `var(--qp-card-pad)` 会直接压在 footer 按钮上
 *     （footer 与 `.qp-card-footer` 同几何：32 高 + 底部负边距贴到卡片下缘，见
 *     `dashboard-todos-compose.css` 的 `.qp-todo-foot`）；
 *  ② 列表是 flex 子项，默认 `min-height: auto` —— 加了 footer 之后容器一矮，
 *     列表拒不收缩，整卡被顶出滚动区。
 */
describe("待办卡的卡底 footer 守卫", () => {
  it("p07a_todo_undo_bar_clears_the_footer", () => {
    const css = readCss("../../../app/styles/features/dashboard-todos.css");
    const bar = cssBlock(css, ".qp-undo-bar");
    const bottom = (/bottom: ([^;]+);/.exec(bar)?.[1] ?? "");
    expect(bottom, "撤销条的 bottom 必须让开卡底 footer（不含 --qp-card-foot-h 就是贴回了卡底）")
      .toContain("var(--qp-card-foot-h)");
    expect(bottom, "不许退回旧的 var(--qp-card-pad)：那会盖住「＋ 新建待办」")
      .not.toBe("var(--qp-card-pad)");
  });

  it("p07b_todo_list_can_shrink_below_footer", () => {
    const css = readCss("../../../app/styles/features/dashboard-todos.css");
    expect(cssBlock(css, ".qp-todo-list"), "列表必须 min-height: 0，否则加了 footer 会把卡片顶出滚动")
      .toContain("min-height: 0");
  });
});
