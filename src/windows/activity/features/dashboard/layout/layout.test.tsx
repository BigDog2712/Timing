import { beforeEach, describe, expect, it } from "vitest";
import { LAYOUT_STORAGE_KEY, type DashboardLayout } from "./contract";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import { normalizeLayout } from "./normalizeLayout";
import { LEGACY_STORAGE_KEY, loadLayout, resetLayout, saveLayout } from "./layoutStore";
import { useBoardStore } from "./boardStore";
import { firstOverlap } from "./geometry";

/**
 * [v3] 布局模型判据：**坏数据不许让界面空着，也不许静默把用户的卡丢掉**。
 *
 * 与 v2 的差别：v2 版本不符直接回默认（旧数据丢弃重来，主人认可过）；v3 对 **v2 数据做迁移**
 * ——自由摆位是新模型，但用户上一版的排布没必要因此归零。迁移的期望值按 dense 流式
 * 重放算出来，写死在下面的表里（改算法就会红，这正是要的）。
 */
const v2Default = {
  version: 2,
  cards: [
    { id: "timer", x: 0, w: 2, h: 1, tier: "M" },
    { id: "apps", x: 2, w: 2, h: 1, tier: "M" },
    /* v2 时代第二行左侧是「事项分布」，那张卡已下线；这里换成同类位置的 trend，
     * 迁移的落位数学（dense 重放）才测得动 */
    { id: "trend", x: 0, w: 2, h: 1, tier: "M" },
    { id: "todos", x: 2, w: 2, h: 2, tier: "M" },
    { id: "notes", x: 0, w: 4, h: 1, tier: "M" },
  ],
};

describe("normalizeLayout（自由摆位 v3）", () => {
  it("非对象 / 未知版本回出厂布局", () => {
    expect(normalizeLayout("nope").reason).toBe("not-an-object");
    expect(normalizeLayout({ version: 1, cards: [] }).reason).toBe("version-mismatch");
    expect(normalizeLayout({ version: 999, cards: [] }).reason).toBe("version-mismatch");
    expect(normalizeLayout(undefined).layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("空卡表回出厂布局（板子空着比回默认更让人以为坏了）", () => {
    const result = normalizeLayout({ version: 3, cards: [] });
    expect(result.reason).toBe("empty-cards");
    expect(result.layout.cards.length).toBe(DEFAULT_LAYOUT.cards.length);
  });

  it("v2 网格按 dense 流式重放成像素矩形，一张卡不丢", () => {
    const result = normalizeLayout(v2Default);
    expect(result.reason).toBe("migrated-from-v2");
    const rects = result.layout.cards.map((card) => [card.kind, card.x, card.y, card.w, card.h]);
    expect(rects).toEqual([
      ["timer", 0, 0, 518, 264],
      ["apps", 534, 0, 518, 264],
      ["trend", 0, 280, 518, 264],
      ["todos", 534, 280, 518, 544],
      /* v2 的 4 跨列 = 4×251 + 3×16 = 1052，与新画布 1250 无关：迁移只是把旧网格换算成像素 */
      ["notes", 0, 840, 1052, 264],
    ]);
    /* uid 必须发出来，否则 v3 的删/改/复制全都会指到 undefined */
    expect(result.layout.cards.map((card) => card.uid)).toEqual([1, 2, 3, 4, 5]);
    expect(result.layout.nextId).toBe(6);
  });

  it("未知 kind 丢掉这一张，其余保留；uid 重复重新发号", () => {
    const result = normalizeLayout({
      version: 3,
      nextId: 9,
      snap: true,
      cards: [
        { uid: 1, kind: "timer", x: 0, y: 0, w: 518, h: 264, tier: "M" },
        { uid: 1, kind: "apps", x: 534, y: 0, w: 518, h: 264, tier: "M" },
        { uid: 3, kind: "nope", x: 0, y: 0, w: 100, h: 100 },
        /* 这两张是真的被主人摘掉的组件：老布局文件里还留着，读进来必须安静地清掉，
         * 不能因为「有个不认识的 kind」就整份回默认（那会把用户其余排布一起抹了） */
        { uid: 5, kind: "items", x: 0, y: 280, w: 518, h: 264, tier: "M" },
        /* [本轮 T04] `reminder` 回归为合法 kind（活动提醒新卡），这里换一个真不存在的 kind */
        { uid: 6, kind: "gauge", x: 534, y: 280, w: 518, h: 264, tier: "M" },
        { uid: 4, kind: "notes", x: 0, y: 600, w: 1052, h: 264, tier: "M" },
      ],
    });
    expect(result.repaired).toBe(true);
    expect(result.layout.cards.map((card) => card.kind)).toEqual(["timer", "apps", "notes"]);
    const uids = result.layout.cards.map((card) => card.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(result.layout.nextId).toBeGreaterThan(Math.max(...uids));
  });

  it("非法矩形就地夹紧（不删卡），纵向可以排到首屏之外", () => {
    const result = normalizeLayout({
      version: 3,
      cards: [{ uid: 1, kind: "apps", x: -80, y: 2000, w: 10, h: 10, tier: "M" }],
    });
    expect(result.reason).toBe("illegal-rect");
    const [only] = result.layout.cards;
    expect(only.x).toBe(0);
    expect(only.y).toBe(2000);
    expect(only.w).toBeGreaterThanOrEqual(240);
  });

  it("空白标题当作没写；标题超长截断", () => {
    const result = normalizeLayout({
      version: 3,
      cards: [
        { uid: 1, kind: "apps", x: 0, y: 0, w: 518, h: 264, tier: "M", title: "   " },
        { uid: 2, kind: "apps", x: 534, y: 0, w: 518, h: 264, tier: "M", title: "一".repeat(40) },
      ],
    });
    expect(result.layout.cards[0].title).toBeUndefined();
    expect(result.layout.cards[1].title?.length).toBe(24);
  });
});

describe("layoutStore（v3 键 + v2 迁移）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("存进去读出来一致", () => {
    const layout: DashboardLayout = {
      ...DEFAULT_LAYOUT,
      snap: false,
      cards: [{ uid: 1, kind: "apps", x: 16, y: 32, w: 518, h: 264, tier: "S" }],
    };
    saveLayout(layout);
    const loaded = loadLayout();
    expect(loaded.layout.cards).toEqual(layout.cards);
    expect(loaded.layout.snap).toBe(false);
  });

  it("v3 键为空但 v2 键有数据：迁移并回写", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(v2Default));
    const loaded = loadLayout();
    expect(loaded.reason).toBe("migrated-from-v2");
    expect(loaded.layout.cards[0].kind).toBe("timer");
    /* 回写：v3 键上必须已经有东西，否则每次启动都迁一遍 */
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).not.toBeNull();
  });

  it("坏 JSON 回默认并回写，不抛", () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{not json");
    expect(() => loadLayout()).not.toThrow();
    expect(loadLayout().layout.cards.length).toBeGreaterThan(0);
  });

  it("reset 之后回到出厂布局", () => {
    saveLayout({ ...DEFAULT_LAYOUT, cards: [] });
    resetLayout();
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
    expect(loadLayout().layout.cards.length).toBe(DEFAULT_LAYOUT.cards.length);
  });
});

describe("boardStore（多实例 / 增删 / 尺寸 / 标题）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBoardStore.setState({ layout: cloneLayout(DEFAULT_LAYOUT) });
  });

  it("同一种组件可以加多张，落点互不重叠", () => {
    const store = useBoardStore.getState();
    const first = store.add("todos");
    const second = useBoardStore.getState().add("todos");
    const cards = useBoardStore.getState().layout.cards;
    expect(first).not.toBe(second);
    expect(cards.filter((card) => card.kind === "todos").length).toBeGreaterThanOrEqual(2);
    expect(firstOverlap(cards)).toBeNull();
  });

  it("复制一张：新 uid、偏移 16px，原卡不动", () => {
    const store = useBoardStore.getState();
    const source = store.layout.cards[0];
    const copyUid = useBoardStore.getState().duplicate(source.uid);
    const cards = useBoardStore.getState().layout.cards;
    const copy = cards.find((card) => card.uid === copyUid);
    expect(copy?.kind).toBe(source.kind);
    expect(copy?.x).toBe(source.x + 16);
    expect(cards.find((card) => card.uid === source.uid)?.x).toBe(source.x);
  });

  it("移除 / 切档 / 改名 / 恢复默认", () => {
    const store = useBoardStore.getState();
    const target = store.layout.cards[0];

    useBoardStore.getState().setTier(target.uid, "S");
    expect(useBoardStore.getState().layout.cards[0].h).toBeLessThan(target.h);

    useBoardStore.getState().setTitle(target.uid, "上午的会议");
    expect(useBoardStore.getState().layout.cards[0].title).toBe("上午的会议");
    useBoardStore.getState().setTitle(target.uid, "  ");
    expect(useBoardStore.getState().layout.cards[0].title).toBeUndefined();

    useBoardStore.getState().remove(target.uid);
    expect(useBoardStore.getState().layout.cards.some((card) => card.uid === target.uid)).toBe(false);

    useBoardStore.setState({ layout: cloneLayout(DEFAULT_LAYOUT) });
    expect(useBoardStore.getState().layout.cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("拖动预览不落盘，松手才写；非法矩形被夹紧", () => {
    const store = useBoardStore.getState();
    const target = store.layout.cards[0];
    useBoardStore.getState().moveTo(target.uid, { x: -100, y: 40, w: 10, h: 10 }, false);
    const preview = useBoardStore.getState().layout.cards[0];
    expect(preview.x).toBe(0);
    expect(preview.y).toBe(40);
    /* 预览阶段没写盘：存储里还是旧值 */
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    expect(stored.cards?.[0]?.y).not.toBe(40);
  });

  it("整理后两两不相交", () => {
    const store = useBoardStore.getState();
    const uid = store.layout.cards[0].uid;
    useBoardStore.getState().moveTo(uid, { x: 300, y: 300, w: 518, h: 264 }, true);
    useBoardStore.getState().tidy();
    expect(firstOverlap(useBoardStore.getState().layout.cards)).toBeNull();
  });
});
