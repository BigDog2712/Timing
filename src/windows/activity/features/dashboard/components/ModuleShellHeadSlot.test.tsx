(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { ChevronUp } from "lucide-react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ModuleShell, { type ModuleState } from "./ModuleShell.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";

/**
 * 卡头**右槽**里不许出现文字键（`headAction` 槽下线之后的护栏）。
 * -----------------------------------------------------------------------------
 * 待办卡的「新建待办」搬过两次家：卡底 `footer` → 卡头右槽（`headAction`）→ 卡头下方
 * 那条 24 高的通栏窄行（`subhead`）。搬走之后 `headAction` 全仓零调用点，成了死槽：
 * 留着它，下一个人"顺手"把入口放回去零报错，读数又被挤窄。
 *
 * 三条判据，都是**渲染级**：
 *  ① 四态里右槽都只有图标键（`controls` / E3 图标 / meta 读数），**没有**文字键；
 *  ② 那座"常驻入口"的位置在 `subhead`（卡头的下一个兄弟、四态都在）—— 这正是入口
 *     现在的家，也是"待办卡空态也要能新建"那条语义的载体；
 *  ③ 类型级：`headAction` 这个 prop 已经不存在（下面那行 `@ts-expect-error` 会在
 *     `npm run check` 的 `tsc --noEmit` 里把关：谁把 prop 加回来，"未使用的
 *     @ts-expect-error"立刻变成类型错误）。
 *
 * 为什么不复用 `TodosModule.test.tsx`：那四条（tq08/tq09）盯的是**待办卡**里那一个入口
 * 的位置，需要整套 IPC mock。这里盯的是**外壳**这一层的槽位契约，一张卡都不需要挂。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 四态取全：`headAction` 当年唯一的特点就是"不受四态门控"，所以四态都要验 */
const STATES: readonly ModuleState[] = ["ready", "empty", "loading", "error"];

/** 右槽里那颗图标键（真实板的 `controls` 就是 `QuietIconAction`，类名 `qp-icon-action`） */
const controlsNode = () => createElement(QuietIconAction, {
  icon: createElement(ChevronUp, { size: 14 }),
  title: "上移",
  onClick: () => undefined,
});

function mount(state: ModuleState): void {
  act(() => {
    root?.render(createElement(ModuleShell, {
      id: "t-probe",
      title: "待办",
      state,
      emptyText: "今天没有待办",
      errorText: "读取失败",
      retryLabel: "重试",
      onRetry: () => undefined,
      meta: state === "ready" ? "3 条待办" : undefined,
      controls: controlsNode(),
      /* 入口现在的家：卡头下方的通栏窄行 */
      subhead: createElement(
        "div",
        { className: "qp-probe-subhead" },
        createElement("button", { type: "button", className: "qp-link-btn" }, "新建待办"),
      ),
      children: createElement("div", { className: "qp-probe-body" }, "内容"),
    }));
  });
}

const headRight = () => container?.querySelector<HTMLElement>(".qp-card-head-right") ?? null;

/**
 * 右槽里的**文字键** = 不带 `qp-icon-action` 类的 `button`。
 * 图标键的可见内容都挂在 `aria-hidden` 的子节点上，可读名字走 `aria-label`；
 * 一颗文字键（"新建待办"这种）没有 `qp-icon-action` 类 —— 这就是判据。
 */
const textKeys = (): HTMLButtonElement[] => Array.from(
  headRight()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
).filter((button) => !button.classList.contains("qp-icon-action"));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

describe("ModuleShell · 卡头右槽只有图标键与读数", () => {
  it("mh01_no_text_key_in_the_right_slot_in_any_of_the_four_states", () => {
    for (const state of STATES) {
      mount(state);
      const right = headRight();
      expect(right, `${state} 态没有卡头右槽`).not.toBeNull();
      /* 图标键控件照旧在（不是"把整个右槽删了"也算过） */
      expect(
        right?.querySelector(".qp-icon-action"),
        `${state} 态把 controls 弄丢了（判据不能靠"右槽整个空掉"过关）`,
      ).not.toBeNull();
      expect(
        textKeys().map((button) => button.textContent),
        `${state} 态右槽里出现了文字键 —— 20px 高的卡头要被读数与它挤成两行`,
      ).toEqual([]);
      expect(
        right?.textContent ?? "",
        `${state} 态右槽里印出了入口的文字`,
      ).not.toContain("新建待办");
    }
  });

  it("mh02_the_meta_readout_only_appears_in_the_ready_state", () => {
    for (const state of STATES) {
      mount(state);
      const meta = container?.querySelector(".qp-card-meta");
      if (state === "ready") {
        expect(meta?.textContent, "ready 态丢了读数").toBe("3 条待办");
      } else {
        expect(meta, `${state} 态不该印读数（空态的数字是废话 / 错误态不可信 / 加载态还没有）`)
          .toBeNull();
      }
    }
  });

  it("mh03_the_subhead_row_is_the_card_heads_next_sibling_in_all_four_states", () => {
    /* 入口现在的家（`subhead`），而且必须四态都在 —— 这是它从卡头右槽搬下来的**理由**
       （空态正是最想点「新建待办」的时刻）。`children` 只在 ready 渲染，替代不了它。 */
    for (const state of STATES) {
      mount(state);
      const head = container?.querySelector(".qp-card-head");
      const subhead = container?.querySelector(".qp-probe-subhead");
      expect(subhead, `${state} 态没有 subhead 那一行`).not.toBeNull();
      expect(head?.nextElementSibling, `${state} 态 subhead 不在卡头之后`).toBe(subhead);
    }
  });

  it("mh04_the_head_action_prop_is_gone", () => {
    /* 类型级判据：`headAction` 已经从 Props 里删除。谁把它加回来，这一行就不再报错，
       `@ts-expect-error` 变成"未使用的指令" → `tsc --noEmit` 直接失败（`npm run check`
       的第二步）。这正是我们要的：死槽不许复活。 */
    const base = {
      id: "t-probe",
      title: "待办",
      state: "ready" as ModuleState,
      emptyText: "",
      children: null,
    };
    // @ts-expect-error `headAction` 已下线（见 ModuleShell.tsx 文件头）：加回来这一行就会报错
    void createElement(ModuleShell, { ...base, headAction: createElement("button", null, "新建待办") });
    expect(Object.keys(base)).toContain("state");
  });

  it("mh05_the_right_slot_still_orders_the_readout_before_the_controls", () => {
    /* [QA 补测] 右槽的**顺序**契约：`meta` 读数贴左、`controls` 工具条贴右。删 `headAction`
       那一行只是把最左侧删掉，没有动这个顺序 —— 但在此之前没有任何一条用例钉住它
       （旧 tq09 钉的是 `headAction` 的下标，随槽一起删了）。变异靶点：把 `{controls}` 挪到
       ready 分支之前，两条断言都会红。 */
    mount("ready");
    const right = headRight();
    const meta = right?.querySelector<HTMLElement>(".qp-card-meta") ?? null;
    const control = right?.querySelector<HTMLElement>(".qp-icon-action") ?? null;
    expect(meta, "ready 态丢了读数").not.toBeNull();
    expect(control, "ready 态丢了工具条").not.toBeNull();
    expect(
      meta!.compareDocumentPosition(control!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "右槽顺序变了：读数必须在工具条之前（meta 贴左、⋯ 贴右）",
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(right?.lastElementChild?.contains(control), "工具条必须仍是右槽最后一个元素").toBe(true);
  });
});
