// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import dashboard from "./Dashboard.tsx?raw";
import boardSource from "../layout/DashboardBoard.tsx?raw";
import canvasSource from "../layout/BoardCanvas.tsx?raw";
import zoomSource from "../layout/useBoardZoom.ts?raw";
import frameSource from "../layout/BoardCardFrame.tsx?raw";
import dragSource from "../layout/useBoardDrag.ts?raw";
import todosZoneSource from "./TodosZone.tsx?raw";

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
    expect(dashboard).not.toContain("at-grid");
    expect(dashboard).not.toContain("buildGridCards");
  });

  it("p01b_toolbar_is_a_sibling_and_before_the_canvas", () => {
    const toolbar = boardSource.indexOf("at-dashboard-toolbar");
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

    const css = readCss("../../../shell/styles/features/dashboard-board.css");
    /* 原点必须是左上：以中心为原点缩放时，卡片会越缩越往右下漂 */
    expect(cssBlock(css, ".at-board-canvas")).toContain("transform-origin: top left");
    /* 画布是绝对定位的，尺寸完全由 inline 宽高 + scale 决定 */
    expect(cssBlock(css, ".at-board-canvas")).toContain("position: absolute");

    /* 滚动归属：画布两个方向都要能滚，否则倍率 > 1 时右边那列看不到 */
    const zoomCss = readCss("../../../shell/styles/features/dashboard-board-zoom.css");
    expect(cssBlock(zoomCss, ".at-board-scroll")).toContain("overflow: auto");
    expect(cssBlock(zoomCss, ".at-main-view")).toContain("min-height: 0");
  });

  it("p01d_cards_are_positioned_by_the_layout_model", () => {
    expect(frameSource).toContain("left: card.x, top: card.y, width: card.w, height: card.h");
    expect(cssBlock(readCss("../../../shell/styles/features/dashboard-board.css"), ".at-board-card"))
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
    const head = frameSource.indexOf(".at-card-head, .at-notes-head, .at-board-grab");
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
    /* [本轮 T04] 活动提醒回归为新卡（原工具页分区迁入）。
       [0.12.6] 两张卡壳按用户口径拆成 `timeline`（上区待办 / 下区记录）与 `manage`
       （事项管理）—— 分发里必须是这两个名字，写回作废的合并卡就是"点开少半屏"。 */
    for (const tag of [
      "TimerModule",
      "AppsModule",
      "TimelineTodosCard",
      "ManageCard",
      "NotesStrip",
      "TrendModule",
      "HeatmapModule",
      "ReminderModule",
    ]) {
      expect(cards, `分发里少了 ${tag}`).toContain(`<${tag}`);
    }
    /* 下线的组件不许留在分发里：留着就是「能加成空框」。
       [0.12.6] `TodosModule` / `TimelineCard` 两张旧卡壳、作废的合并卡 `ItemsCard` 一起下线。 */
    for (const gone of ["ItemsModule", "TodosModule", "TimelineCard", "ItemsCard", "ItemsTimelineZone"]) {
      expect(cards, `${gone} 已下线`).not.toContain(`<${gone}`);
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
    /* [0.12.6] 行容器现在挂在**时间线卡的下区**（时间线区）：`.at-card-items` 是那张卡的
       卡壳类名（`__upper` 是待办区、`__lower` 是时间线区），原来那条 `.at-card-timeline`
       规则随旧卡壳下线，判据改读新文件。 */
    const itemsCss = readCss("../../../shell/styles/features/dashboard-items-card.css");
    const rows = cssBlock(itemsCss, ".at-card-items .at-timeline-rows");
    expect(rows, "行容器必须纵向可滚（否则窄档裁半行）").toContain("overflow-y: auto");
    expect(rows, "横向仍要裁：时间线不横向滚动").toContain("overflow-x: hidden");
    /* 行项不许被压扁：列向 flex 子项默认 `flex-shrink: 1`，容器一矮就把 30px 挤成 26/15。
       压扁比裁行更隐蔽（裁口消失了，但行高已经不是 30），所以这条也要钉。 */
    expect(cssBlock(readCss("../../../shell/styles/features/dashboard-layout.css"), ".at-timeline-row"),
      "行高必须固定 30，不许被压缩").toContain("flex: 0 0 auto");
  });
});

/**
 * 待办区（`.at-card-items__upper`）的卡底 / 收缩守卫
 * （2026-11-12 建，[本轮] 入口从卡底 footer 搬到区标题行下方后重锚）。
 *
 * 两类"改回去零报错、只会某天被报『撤销条悬空 / 卡片顶出滚动』"的接线：
 *  ① 撤销条是 absolute；卡底那条 32 高的入口条（`.at-todo-foot`）本轮随入口搬到卡头
 *     一起下线，所以 `bottom` 回到卡片自己的底部内距 `--at-card-pad-b` + 8px 间隙。
 *     还留着 `--at-card-foot-h` 就是照旧几何算的 —— 没有实体接住那 32px，撤销条会悬空。
 *  ② 列表是 flex 子项，默认 `min-height: auto` —— 容器一矮，列表拒不收缩，整卡被顶出滚动区。
 */
describe("待办区的卡底守卫", () => {
  it("p07a_todo_undo_bar_sits_above_the_card_bottom_padding", () => {
    const css = readCss("../../../shell/styles/features/dashboard-todos.css");
    const bar = cssBlock(css, ".at-undo-bar");
    const bottom = (/bottom: ([^;]+);/.exec(bar)?.[1] ?? "");
    expect(bottom, "撤销条的 bottom 必须挂在卡片底部内距（--at-card-pad-b）上")
      .toContain("var(--at-card-pad-b)");
    expect(bottom, "卡底入口条已下线，再留 --at-card-foot-h 会让撤销条悬空 16px")
      .not.toContain("var(--at-card-foot-h)");
  });

  it("p07b_todo_list_still_shrinks_so_the_card_never_overflows", () => {
    const css = readCss("../../../shell/styles/features/dashboard-todos.css");
    expect(cssBlock(css, ".at-todo-list"), "列表必须 min-height: 0，否则行数一多就把卡片顶出滚动区")
      .toContain("min-height: 0");
  });
});

/**
 * 待办区「新建待办」**入口位置**守卫（[本轮]：卡头右槽 → 区标题行下方一条通栏窄行）。
 *
 * 搬这一趟的理由是排版（右槽要同时摆「N 条待办」读数与 `⋯` 控件），所以这里钉的是
 * **那一行的样式契约**：必须是紧凑的 —— 长成大号按钮就等于把列表的可见行数还回去
 * （那正是上一轮把入口从 footer 搬走的理由），旧的卡头键样式也不许留成死规则。
 *
 * 「入口不许搬回卡头右槽」那一条**不再**是源码 grep：`headAction` 这个 prop 已经整段
 * 删除，`not.toContain("headAction=")` 就成了一句永真的废话。改成渲染级判据：
 *   · `ModuleShellHeadSlot.test.tsx` —— 外壳右槽四态里都没有文字键（`headAction` 槽下线）；
 *   · `TodosModule.test.tsx` 的 tq09 —— 区标题行里没有那颗入口键。
 */
describe("待办区的新建入口位置", () => {
  it("p07c_the_new_entry_is_a_compact_row_below_the_card_head", () => {
    const css = readCss("../../../shell/styles/features/dashboard-todos.css");
    const row = cssBlock(css, ".at-todo-new-row");
    expect(row, "一行文字键的紧凑高度：长成大号按钮会吃掉列表可见行数").toContain("height: 24px");
    expect(row, "右对齐：与卡头右槽同一根轴线").toContain("justify-content: flex-end");
    expect(css, "旧的卡头键样式随入口一起下线，别留死规则").not.toContain(".at-card-head-link");

    /* 这一条只证明"源码里有这个行容器"，**证明不了它在 subhead 里**（同文件里出现一次就够）。
       真正的位置判据是渲染级的 `TodosModule.test.tsx` 的 tq09：`head.nextElementSibling`
       === 这一行 + `compareDocumentPosition` 排在列表之前。这里保留它只是因为"入口整段
       消失"这种编辑在源码层面一句话就能红，位置对不对交给 tq09。 */
    expect(todosZoneSource, "源码里必须有 `at-todo-new-row` 这个行容器；位置判据见 TodosModule.test.tsx 的 tq09")
      .toContain('className="at-todo-new-row"');
  });
});
