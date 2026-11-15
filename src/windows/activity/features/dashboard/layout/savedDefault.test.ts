/**
 * [v3.2 → 0.13] 老「默认布局」键（`patina:dashboard-layout:default:v1`）的两条职责。
 *
 * 0.13 之前它是「保存布局 / 恢复默认」两颗按钮的存储；那两颗按钮随工具栏收成三入口
 * 一并下线（布局库 `library.ts` 接管「新建 / 切换 / 删除」）。但这个键**没有废弃**，
 * 它还剩两条职责，两条都必须继续成立：
 *   ① **迁移来源**：老用户存过默认版，第一次读到空库时把它导入成 `items[0]`
 *      （判据在 `library.test.ts` 的 v14a_legacy_default_key_is_migrated）；
 *   ② **读不到当前排布时的落点**：当前排布那一键坏了（坏 JSON / 手动清缓存）时，
 *      `loadLayout()` 回落的是它，而不是出厂版 —— 坏存档不该把人辛苦摆的布局换成出厂。
 * 第 ② 条是本文件的主题：`boardStore.createLayout` 每次新建布局都要把它同步一次，
 * 否则它永远停在迁移前那一版，第 ② 条就成了一个「回退到很久以前」的陷阱。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./boardStore";
import { LAYOUT_STORAGE_KEY } from "./contract";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { emptyLibrary } from "./library";
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

beforeEach(() => {
  window.localStorage.clear();
  useBoardStore.setState({
    layout: cloneLayout(DEFAULT_LAYOUT),
    locked: false,
    library: emptyLibrary(),
    libraryHydrated: false,
  });
});

describe("老「默认布局」键的存档校验", () => {
  it("存档坏了当作没存过，不许抛错也不许白板", () => {
    window.localStorage.setItem(DEFAULT_LAYOUT_STORAGE_KEY, "{not json");
    expect(loadSavedDefault()).toBeNull();
  });

  it("空卡表不算默认版（空板和坏存档在读取时无法区分）", () => {
    saveSavedDefault({ ...DEFAULT_LAYOUT, cards: [] });
    expect(loadSavedDefault()).toBeNull();
  });
});

describe("老「默认布局」键是「读不到当前排布」时的落点", () => {
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

describe("新建布局时同步老键（否则第 ② 条会回退到很久以前那一版）", () => {
  it("createLayout 之后，默认版就是刚存的那一版", () => {
    useBoardStore.setState({ layout: cloneLayout(CUSTOM) });
    expect(useBoardStore.getState().createLayout("布局 1")).toBe(true);

    const stored = loadSavedDefault();
    expect(stored?.cards).toEqual(CUSTOM.cards);
    expect(stored?.snap).toBe(false);
  });

  it("空板不建布局，也不动老键（空卡表会被读侧当成「没存过」）", () => {
    useBoardStore.setState({ layout: { ...cloneLayout(DEFAULT_LAYOUT), cards: [] } });
    expect(useBoardStore.getState().createLayout("布局 1")).toBe(false);
    expect(loadSavedDefault()).toBeNull();
    expect(useBoardStore.getState().library.items.length).toBe(0);
  });

  it("存完之后接着拖卡，老键是快照、不跟着变", () => {
    useBoardStore.setState({ layout: cloneLayout(CUSTOM) });
    useBoardStore.getState().createLayout("布局 1");
    useBoardStore.getState().moveTo(1, { x: 100, y: 200, w: 320, h: 168 });
    expect(loadSavedDefault()?.cards[0].x).toBe(40);
    expect(useBoardStore.getState().library.items[0].layout.cards[0].x).toBe(40);
  });
});
