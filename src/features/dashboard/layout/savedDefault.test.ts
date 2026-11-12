/**
 * [v3.2 · 保存布局] 「保存后即为默认布局」的判据。
 *
 * 要钉的四件事：
 *   ① 存完之后「恢复默认」回的是**存的那一版**，不是出厂那版；
 *   ② 没存过 / 存档坏了 / 空卡表 → 一律回出厂（不许把板子恢复成一片空白）；
 *   ③ 「当前排布」与「默认排布」是两个键：存完接着拖，默认版不跟着变；
 *   ④ 「出厂布局」是条单向门，不删已存的默认版（手滑还能 reset 回去）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./boardStore";
import { LAYOUT_STORAGE_KEY } from "./contract";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import {
  DEFAULT_LAYOUT_STORAGE_KEY,
  loadLayout,
  loadSavedDefault,
  saveSavedDefault,
} from "./layoutStore";

/** 一版手摆的布局：位置与出厂栅格都不同（40 / 128 不是 24 / 344），一眼能分辨回的是哪版。 */
const CUSTOM = {
  ...DEFAULT_LAYOUT,
  nextId: 2,
  snap: false,
  cards: [{ uid: 1, kind: "notes" as const, x: 40, y: 128, w: 320, h: 168, tier: "M" as const }],
};

function cardsNow() {
  return useBoardStore.getState().layout.cards;
}

beforeEach(() => {
  window.localStorage.clear();
  useBoardStore.setState({ layout: cloneLayout(DEFAULT_LAYOUT), customDefault: false });
});

describe("保存布局 = 存一份默认快照", () => {
  it("存完之后「恢复默认」回到存的那一版，不是出厂那版", () => {
    useBoardStore.setState({ layout: cloneLayout(CUSTOM) });
    useBoardStore.getState().saveAsDefault();
    expect(useBoardStore.getState().customDefault).toBe(true);

    /* 存完再拖乱 */
    useBoardStore.getState().moveTo(1, { x: 640, y: 480, w: 320, h: 168 });
    expect(cardsNow()[0].x).toBe(640);

    useBoardStore.getState().reset();
    expect(cardsNow()).toEqual(CUSTOM.cards);
    expect(useBoardStore.getState().layout.snap).toBe(false);
  });

  it("没存过就「恢复默认」→ 出厂布局（老行为不变）", () => {
    useBoardStore.getState().add("notes");
    useBoardStore.getState().reset();
    expect(cardsNow()).toEqual(DEFAULT_LAYOUT.cards);
    expect(useBoardStore.getState().customDefault).toBe(false);
  });

  it("存档坏了当作没存过，不许抛错也不许白板", () => {
    window.localStorage.setItem(DEFAULT_LAYOUT_STORAGE_KEY, "{not json");
    expect(loadSavedDefault()).toBeNull();
    expect(() => useBoardStore.getState().reset()).not.toThrow();
    expect(cardsNow()).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("空卡表不算默认版（空板和坏存档在读取时无法区分）", () => {
    saveSavedDefault({ ...DEFAULT_LAYOUT, cards: [] });
    expect(loadSavedDefault()).toBeNull();
    useBoardStore.getState().reset();
    expect(cardsNow()).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("存完接着拖卡，默认版是快照、不跟着变", () => {
    useBoardStore.setState({ layout: cloneLayout(CUSTOM) });
    useBoardStore.getState().saveAsDefault();
    useBoardStore.getState().moveTo(1, { x: 100, y: 200, w: 320, h: 168 });
    expect(loadSavedDefault()?.cards[0].x).toBe(40);
  });
});

describe("默认布局也是「读不到当前排布」时的落点", () => {
  it("当前排布那份 JSON 坏了 → 落在默认版，而不是出厂版", () => {
    saveSavedDefault(CUSTOM);
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{broken");
    const loaded = loadLayout();
    expect(loaded.reason).toBe("invalid-json");
    expect(loaded.layout.cards).toEqual(CUSTOM.cards);
  });

  it("当前排布键被清掉（首次运行 / 手动清缓存）→ 默认版", () => {
    saveSavedDefault(CUSTOM);
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    expect(loadLayout().layout.cards).toEqual(CUSTOM.cards);
  });
});

describe("出厂布局是单向门，不删已存的默认版", () => {
  it("恢复出厂之后还能 reset 回自己那版", () => {
    saveSavedDefault(CUSTOM);
    useBoardStore.setState({ customDefault: true, layout: cloneLayout(CUSTOM) });

    useBoardStore.getState().resetToFactory();
    expect(cardsNow()).toEqual(DEFAULT_LAYOUT.cards);
    expect(useBoardStore.getState().customDefault).toBe(true);
    expect(loadSavedDefault()?.cards).toEqual(CUSTOM.cards);

    useBoardStore.getState().reset();
    expect(cardsNow()).toEqual(CUSTOM.cards);
  });
});
