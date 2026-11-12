(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 便利贴弹层「展开后可删除」的判据（[本轮]）。
 *
 * 钉三件事，全是"错了也照样渲染"的：
 *   ① 删除**必须二次确认**：第一下只弹内联确认条，一个意图都不许发 —— 便利贴是用户手写的
 *      东西，误触一次就永久丢了（`note_delete` 没有撤销）；
 *   ② 确认后发出的意图里 `noteId` 必须是**那一张**的 id。变异自证：把 id 换成常量 0，
 *      断言立刻红（宿主会去删一张不存在的贴，而用户那张还在）；
 *   ③ 发完意图要立刻调 `model.removeLocal(id)` 并关弹层 —— 否则 30s 后的刷新会把它放回来。
 *
 * 三个写操作都没有：分析窗没有写命令，唯一的出口是 `patina:host-intent`。
 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({
  emitHostIntent: h.emitHostIntent,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import NotesStrip from "./NotesStrip.tsx";
import type { TodayNotesState } from "../hooks/useTodayNotes.ts";
import type { NoteSummary } from "../../../shared/types/notes.ts";

function note(id: number, content: string): NoteSummary {
  const at = new Date(2026, 10, 11, 10, 0, 0).getTime();
  return { id, itemId: null, content, createdAt: at, updatedAt: at };
}

/** 返回 { state, removeLocal }：state 合 TodayNotesState，removeLocal 单独持有以便断言调用 */
function model(notes: NoteSummary[]) {
  const removeLocal = vi.fn((_noteId: number) => undefined);
  const state: TodayNotesState = {
    notes,
    total: notes.length,
    status: "ready",
    retry: () => undefined,
    removeLocal,
  };
  return { state, removeLocal };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(element: Parameters<Root["render"]>[0]) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
}

/** 弹层是 portal 到 `document.body` 的，查询也在 body 上做，不能只看 container */
function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".qp-note-dialog");
}

function actionButtons(): HTMLButtonElement[] {
  return Array.from(dialog()?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? []);
}

function clickButton(target: HTMLButtonElement) {
  act(() => { target.click(); });
}

beforeEach(() => {
  h.emitHostIntent.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("NotesStrip · 展开后的删除", () => {
  it("n07_delete_needs_a_second_confirmation_before_any_intent_is_emitted", async () => {
    const { state, removeLocal } = model([note(5, "买牛奶")]);
    await mount(createElement(NotesStrip, { model: state }));

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".qp-note-card")?.click();
    });
    expect(dialog()?.textContent).toContain("买牛奶");

    /* 第一下「删除」只是把确认条亮出来：**零意图**（误触一次就永久丢数据） */
    const first = actionButtons().find((button) => button.textContent === "删除");
    expect(first).toBeTruthy();
    clickButton(first as HTMLButtonElement);
    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("删除这张便利贴？");
    expect(removeLocal).not.toHaveBeenCalled();
    /* 弹层还在（确认条是内联的，没有第二层弹窗） */
    expect(document.body.querySelectorAll(".qp-note-dialog")).toHaveLength(1);
  });

  it("n08_confirming_emits_delete_note_with_that_note_id_and_closes_the_dialog", async () => {
    const { state, removeLocal } = model([note(5, "买牛奶"), note(9, "另一张")]);
    await mount(createElement(NotesStrip, { model: state }));

    await act(async () => {
      container?.querySelectorAll<HTMLButtonElement>(".qp-note-card")[1]?.click();
    });
    clickButton(actionButtons().find((button) => button.textContent === "删除") as HTMLButtonElement);
    /* 确认这一下现在是异步的：先发意图、`sent === true` 才摘本地并关弹层，
       所以要等 promise 落（同步 click 只跑到发出意图为止） */
    await act(async () => {
      actionButtons().find((button) => button.textContent === "删除")?.click();
    });

    /* 删除的是**第二张**（id 9），不是列表里的第一张、也不是 0 */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "delete_note", noteId: 9 });
    /* 本地立刻摘掉：否则下一次刷新会把它放回来（"删了又蹦回来"） */
    expect(removeLocal).toHaveBeenCalledWith(9);
    /* 弹层关闭 */
    expect(dialog()).toBeNull();
  });

  it("n09_cancelling_the_confirmation_keeps_everything_untouched", async () => {
    const { state, removeLocal } = model([note(5, "买牛奶")]);
    await mount(createElement(NotesStrip, { model: state }));

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".qp-note-card")?.click();
    });
    clickButton(actionButtons().find((button) => button.textContent === "删除") as HTMLButtonElement);
    /* 确认条里的「取消」是第一颗（问句在最左，按钮贴右） */
    const cancel = actionButtons().find((button) => button.textContent === "取消");
    clickButton(cancel as HTMLButtonElement);

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(removeLocal).not.toHaveBeenCalled();
    expect(dialog()?.textContent).not.toContain("删除这张便利贴？");
  });

  it("n10_closing_the_dialog_resets_the_pending_confirmation", async () => {
    const { state } = model([note(5, "买牛奶")]);
    await mount(createElement(NotesStrip, { model: state }));

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".qp-note-card")?.click();
    });
    clickButton(actionButtons().find((button) => button.textContent === "删除") as HTMLButtonElement);
    clickButton(actionButtons().find((button) => button.textContent === "取消") as HTMLButtonElement);
    /* 关掉再打开另一张：确认条不许"跟着"到下一张上 */
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".qp-note-card")?.click();
    });
    expect(dialog()?.textContent).not.toContain("删除这张便利贴？");
    expect(actionButtons().map((button) => button.textContent)).toEqual(["取消", "删除"]);
  });

  /**
   * n11：意图**没发出去**（`emitHostIntent` 解析成 `false`）。
   *
   * 这条是"看着删了、重启后回来"的唯一防线：`removeLocal` 会把 id 记进
   * `pendingDeletedRef`，后续 30s 刷新因此不再把它放回来。宿主根本没收到删除，
   * 于是用户界面上贴子消失了，库里的记录还在 —— 下次启动就"复活"。
   *
   * 所以 `sent === false` 时必须**一步都不往前走**：不摘本地、不关弹层、给一句提示。
   * 变异自证：把 `if (!sent) { … return; }` 整段删掉（回到无条件 removeLocal + closeDialog），
   * 本用例立刻红。
   */
  it("n11_when_the_intent_is_not_sent_nothing_is_removed_and_the_dialog_stays_with_a_hint", async () => {
    h.emitHostIntent.mockResolvedValueOnce(false);
    const { state, removeLocal } = model([note(5, "买牛奶")]);
    await mount(createElement(NotesStrip, { model: state }));

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".qp-note-card")?.click();
    });
    clickButton(actionButtons().find((button) => button.textContent === "删除") as HTMLButtonElement);
    /* 确认这一下是异步的（要等 `emitHostIntent` 的 promise 落），必须 await act */
    await act(async () => {
      actionButtons().find((button) => button.textContent === "删除")?.click();
    });

    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "delete_note", noteId: 5 });
    /* 宿主没收到 → 本地清单不能摘（否则「删了」是假象） */
    expect(removeLocal).not.toHaveBeenCalled();
    /* 弹层留着，用户能重试；且有一句看得见的提示 */
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain("删除没有发出去");
    /* 提示是条件渲染的 status 区，出现即播报 */
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toContain("删除没有发出去");
  });
});
