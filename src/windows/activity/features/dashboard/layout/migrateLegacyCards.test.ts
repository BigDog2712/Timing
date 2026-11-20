import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { migrateLegacyCards, normalizeLayout } from "./normalizeLayout";

/**
 * [0.12.6] 退休卡种（`todos` / 作废的 `items`）→ **至多一张 `manage`**，现役 `timeline`
 * 卡**原样保留**的迁移判据（实现：`normalizeLayout.migrateLegacyCards`）。
 *
 * 这条迁移的失败形态全是**静默**的，所以这四类必须齐（`ml01`–`ml05`）：
 *   · 两张旧卡都在 → 恰好两张新卡（留三张 = 一块空槽；只留一张 = 用户的待办看着像丢了）；
 *   · 只有 todos / 只有作废的 items → 只换成 timeline，**不凭空补一张事项管理卡**
 *     （升级后突然多出一块挡视线的卡，比"少一张可以自己加"糟得多）；
 *   · 三张旧卡（脏数据）→ 仍只有一条 timeline + 一条 manage，其余丢弃；
 *   · 一张旧卡都没有 → 一个字节都不许改（否则每次启动都写一次盘，`repaired` 变成常态）。
 *
 * 另外钉五条易漂的口径：
 *   ① **排序键必须确定**：`(y, x, uid)` 三元组 + 「timeline 优先于 items、items 优先于
 *      todos」（同类之间才看 y/x）—— 键不唯一 ⇒ 同一份布局两次迁移落点不同；
 *   ② **uid 不许退成 0**：现役时间线卡保留自己原来的号（不参与"取最小"重排）；由
 *      `rectCard` 重建的那条取命中集合最小的正 uid，撞号/缺失时退到
 *      `max(整份布局正 uid)+1`（0 会在下一次归一化里被当脏数据丢掉）；
 *   ③ 幂等：迁移结果再扫一次什么都命中不到；
 *   ④ **现役 `timeline` 卡不是迁移对象**（`ml07`–`ml10`）：单独出现时不触发迁移、不重建
 *      （`title` / `options` 不丢）。这是本轮的真实缺陷回归 —— 曾经 `timeline` 被算进
 *      "要迁移的旧卡种"，于是含时间线卡的布局**每次读入都命中**：`repaired` 恒真（每次
 *      启动都回写盘 + 一条 console.warn），且这张卡被 `rectCard` 重建后标题与参数静默消失。
 *   ⑤ **只有退休卡种会被丢**（`ml12` / `ml13`）：多出来的 `todos` / `items` 是脏数据，
 *      多出来的 `timeline` 是用户自己加的卡 —— 两个口径相反，混了就是"迁移完卡少了一张"。
 *
 * `w/h` 小于新卡 minSize 时这里**不夹**：统一交给 `clampRect` 收口（`normalizeLayout`
 * 里那一步），所以夹具里允许出现 424 高的 manage 卡。
 */
const M = "M" as const;

interface RawCard {
  uid?: unknown;
  kind?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  tier?: unknown;
  title?: unknown;
  options?: unknown;
}

/** 逐字段摊平，让"顺序 / uid / 矩形 / 档位"一次断言完（少一处就会漏一种回归） */
function rects(cards: readonly unknown[]) {
  return (cards as RawCard[]).map((card) => [card.kind, card.uid, card.x, card.y, card.w, card.h, card.tier]);
}

describe("migrateLegacyCards", () => {
  it("ml01_two_legacy_cards_become_one_timeline_and_one_manage", () => {
    /* 同 y 的一对（出厂里就是这样：时间线在左列 24、待办在中列 380）：
       时间线保留**自己的**矩形与最小 uid，待办整体让位成独立的事项管理卡并沿用它的矩形。 */
    const cards = [
      { uid: 1, kind: "timer", x: 24, y: 24, w: 340, h: 304, tier: M },
      { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 424, tier: "L" },
    ];
    const { cards: merged, migrated } = migrateLegacyCards(cards);
    expect(migrated).toBe(true);
    expect(rects(merged)).toEqual([
      ["timer", 1, 24, 24, 340, 304, "M"],
      /* 矩形与档位都是它自己的：位置是用户摆的，迁移不重新排 */
      ["timeline", 4, 24, 344, 340, 424, "M"],
      ["manage", 5, 380, 344, 330, 424, "L"],
    ]);

    /* 同类之间才由 (y, x, uid) 定序：两张旧待办卡（脏数据）时，视觉在最上/最左的那张
       变成 timeline、另一张变成 manage —— 排序键不确定的画面是"两次启动落点不同"。 */
    const twoTodos = migrateLegacyCards([
      { uid: 8, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
      { uid: 2, kind: "todos", x: 24, y: 100, w: 330, h: 304, tier: M },
    ]);
    expect(rects(twoTodos.cards)).toEqual([
      ["manage", 8, 380, 344, 330, 304, "M"],
      ["timeline", 2, 24, 100, 330, 304, "M"],
    ]);
  });

  it("ml02_only_a_todos_card_never_invents_a_manage_card", () => {
    const { cards: merged, migrated } = migrateLegacyCards([
      { uid: 2, kind: "apps", x: 380, y: 24, w: 330, h: 304, tier: M },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 424, tier: M },
    ]);
    expect(migrated).toBe(true);
    expect(rects(merged)).toEqual([
      ["apps", 2, 380, 24, 330, 304, "M"],
      /* 只有一张旧卡 ⇒ 只产出时间线卡；事项管理卡让用户自己在「加卡」里加 */
      ["timeline", 5, 380, 344, 330, 424, "M"],
    ]);
  });

  it("ml03_the_void_items_kind_is_migrated_too", () => {
    /* `items` 是 0.12.6 中途作废的合并卡种（从未出包，只有开发者本机可能有）：
       兜住它，免得老布局在开发机上被当成"不认识的组件"静默吃掉。 */
    const { cards: merged, migrated } = migrateLegacyCards([
      { uid: 6, kind: "items", x: 24, y: 344, w: 340, h: 424, tier: "S" },
    ]);
    expect(migrated).toBe(true);
    expect(rects(merged)).toEqual([["timeline", 6, 24, 344, 340, 424, "S"]]);
  });

  it("ml04_three_legacy_cards_still_leave_exactly_one_timeline_and_one_manage", () => {
    const { cards: merged } = migrateLegacyCards([
      { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
      { uid: 6, kind: "items", x: 726, y: 344, w: 500, h: 424, tier: M },
    ]);
    /* 真实的时间线卡优先（它自己的矩形 + 最小 uid 4），待办卡让位成 manage（uid 5），
       作废的 items 卡整张丢弃 —— 多出来的那块地不能再留一张卡。 */
    expect(rects(merged)).toEqual([
      ["timeline", 4, 24, 344, 340, 424, "M"],
      ["manage", 5, 380, 344, 330, 304, "M"],
    ]);
  });

  it("ml05_no_legacy_card_means_no_change_at_all", () => {
    const input = [
      { uid: 1, kind: "timer", x: 24, y: 24, w: 340, h: 304, tier: M },
      { uid: 7, kind: "notes", x: 726, y: 584, w: 500, h: 184, tier: M, title: "本周", options: { dim: "app" } },
    ];
    const result = migrateLegacyCards(input);
    expect(result.migrated).toBe(false);
    /* 逐字段不变：标题与 options 也不许在"什么都没命中"时被重建掉 */
    expect(result.cards).toEqual(input);

    /* 幂等：迁移结果再扫一次什么都不命中（否则每次启动都迁一遍、每次都写盘） */
    const migrated = migrateLegacyCards([
      { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
    ]);
    expect(migrateLegacyCards(migrated.cards).migrated).toBe(false);
  });
});

describe("normalizeLayout · 迁移的接线", () => {
  it("ml06_the_migration_is_written_back_with_one_reason_and_a_higher_next_id", () => {
    const result = normalizeLayout({
      version: 3,
      nextId: 3,
      snap: true,
      cards: [
        { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M },
        { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 424, tier: M },
      ],
    });
    expect(result.repaired, "迁移必须回写，否则每次启动都迁一遍").toBe(true);
    expect(result.reason).toBe("migrated-todos-timeline");
    expect(result.layout.cards.map((card) => card.kind)).toEqual(["timeline", "manage"]);
    /* nextId 只增不减：存量声明的 3 比实际 max(uid)+1 = 6 小，取大的那个 */
    expect(result.layout.nextId).toBe(6);
    /* 归一的最后一步仍是 `clampRect`：迁移出来的两张卡都还有合法矩形（没被夹成 0） */
    expect(result.layout.cards.map((card) => [card.x >= 0, card.y >= 0, card.w > 0, card.h > 0]))
      .toEqual([[true, true, true, true], [true, true, true, true]]);
  });
});

/**
 * 现役 `timeline` 卡**不是**迁移对象。
 *
 * 这四条是本轮缺陷的回归：把 `timeline`（`CARD_IDS` 里的现役卡种、出厂布局就摆着一张）
 * 算进"要迁移的旧卡种"，会让**每一份含时间线卡的布局每次读入都命中** —— `repaired` 恒真
 * （每次启动回写盘 + 一条 console.warn），且这张卡被 `rectCard` 重建，`title` / `options`
 * 静默丢失。用户视角是"给卡改的名字，重启就没了"。
 */
describe("现役时间线卡不触发迁移", () => {
  it("ml07_a_live_timeline_card_keeps_its_title_and_options", () => {
    const result = normalizeLayout({
      version: 3,
      nextId: 5,
      snap: true,
      cards: [
        {
          uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M,
          title: "我的时间线", options: { dimension: "item" },
        },
      ],
    });
    expect(result.repaired, "现役卡被当成旧卡种 = 每次启动都判「修过」并回写").toBe(false);
    expect(result.reason).toBeNull();
    expect(result.layout.cards[0].kind).toBe("timeline");
    expect(result.layout.cards[0].title, "卡标题被重建吞掉了").toBe("我的时间线");
    expect(result.layout.cards[0].options).toEqual({ dimension: "item" });
  });

  it("ml08_two_live_timeline_cards_and_nothing_retired_mean_no_migration", () => {
    const input = [
      { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M, title: "我的时间线" },
      { uid: 8, kind: "timeline", x: 380, y: 24, w: 500, h: 424, tier: "L" },
    ];
    const result = migrateLegacyCards(input);
    expect(result.migrated).toBe(false);
    /* 逐字段不变（连 title / tier 都不许被重建掉） */
    expect(result.cards).toEqual(input);
  });

  it("ml09_the_fresh_factory_layout_is_not_repaired", () => {
    /* 用户升级后的**常态**：timeline + manage 两张现役卡、没有 todos/items。
       这条恒真（repaired === true）是最贵的回归 —— 每次启动都写一次盘。 */
    const result = normalizeLayout(DEFAULT_LAYOUT);
    expect(result.repaired).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.layout.cards.map((card) => card.kind))
      .toEqual(DEFAULT_LAYOUT.cards.map((card) => card.kind));
    expect(result.layout.nextId).toBe(DEFAULT_LAYOUT.nextId);
  });

  it("ml10_the_live_timeline_is_kept_as_is_while_todos_becomes_manage", () => {
    const [timeline, manage] = migrateLegacyCards([
      {
        uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M,
        title: "我的时间线", options: { dimension: "item" },
      },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 424, tier: "L", title: "待办事项" },
    ]).cards as RawCard[];
    /* 现役卡：uid / 矩形 / 档位 / 标题 / 参数一个都不动（不重建） */
    expect(timeline).toMatchObject({
      uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M,
      title: "我的时间线", options: { dimension: "item" },
    });
    /* 让位那张：拿自己的矩形与档位，但**不继承旧标题**（「待办事项」挂到「事项管理」上会误导） */
    expect(manage).toMatchObject({ uid: 5, kind: "manage", x: 380, y: 344, w: 330, h: 424, tier: "L" });
    expect(manage.title).toBeUndefined();
  });
});

describe("迁移的 uid 兜底", () => {
  it("ml11_duplicate_uids_fall_back_to_a_free_number_instead_of_zero", () => {
    /* 两张旧卡撞号（脏数据）+ 一张高位号的卡：manage 必须退到**全局 max+1**，
       退成 0 的话它会在下一次归一化里被当脏数据丢掉 —— 而它正是刚迁出来的那张。 */
    const { cards } = migrateLegacyCards([
      { uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M },
      { uid: 4, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
      { uid: 9, kind: "timer", x: 24, y: 24, w: 340, h: 304, tier: M },
    ]);
    expect(rects(cards)).toEqual([
      /* 现役时间线卡保留自己原来的 4（不参与"取最小"重排） */
      ["timeline", 4, 24, 344, 340, 424, "M"],
      ["manage", 10, 380, 344, 330, 304, "M"],
      ["timer", 9, 24, 24, 340, 304, "M"],
    ]);
  });
});

/**
 * 「多余的旧卡」与「多余的现役卡」是两个相反的口径，别混：
 *   · 多出来的 `todos` / `items` 是**脏数据**（同一份布局里不该有两张），迁移时丢弃；
 *   · 多出来的 `timeline` 是**用户自己加的**（板子本来就允许同种多张，「加卡」与「复制」都
 *     能造出来），一张都不许吞 —— 漏掉这条的症状是"迁移完我摆的第二张时间线卡没了"，
 *     零报错、零提示，用户只会以为卡被删了。
 */
describe("迁移只丢退休卡种，现役卡一张都不许吞", () => {
  it("ml12_a_second_live_timeline_card_survives_the_migration", () => {
    const fixture = [
      {
        uid: 4, kind: "timeline", x: 24, y: 344, w: 340, h: 424, tier: M,
        title: "我的时间线", options: { dimension: "item" },
      },
      { uid: 9, kind: "timeline", x: 726, y: 344, w: 500, h: 424, tier: "L", title: "第二条时间线" },
      { uid: 5, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
    ];
    const { cards, migrated } = migrateLegacyCards(fixture);
    expect(migrated).toBe(true);

    const live = cards as RawCard[];
    expect(rects(cards)).toEqual([
      /* 第一张现役卡：位置来源，原样保留（uid / 矩形 / 档位 / 标题 / 参数） */
      ["timeline", 4, 24, 344, 340, 424, M],
      /* 第二张现役卡：不是位置来源、也不是让位方，但它**不是**退休卡种 → 原样留下 */
      ["timeline", 9, 726, 344, 500, 424, "L"],
      /* 待办卡让位成事项管理，拿自己的矩形 */
      ["manage", 5, 380, 344, 330, 304, M],
    ]);
    expect(live[0]).toMatchObject({ title: "我的时间线", options: { dimension: "item" } });
    expect(live[1]).toMatchObject({ title: "第二条时间线" });

    /* 整条归一化：三张卡的号都还在，nextId 按 max(4, 9, 5)+1 = 10 */
    const normalized = normalizeLayout({ version: 3, nextId: 4, snap: true, cards: fixture });
    expect(normalized.layout.cards.map((card) => [card.kind, card.uid])).toEqual([
      ["timeline", 4],
      ["timeline", 9],
      ["manage", 5],
    ]);
    expect(normalized.layout.nextId).toBe(10);
  });

  it("ml13_extra_retired_cards_are_still_dropped", () => {
    /* 与 ml12 成对：同样是"多出来一张"，旧待办是脏数据、要丢；现役时间线是用户的卡、要留。
       夹具里刻意只放同类旧卡 —— 混进 `items` 就会撞上口径 ①（items 优先于 todos 当位置来源），
       那测的就不是"多出来的被丢"了。 */
    const { cards } = migrateLegacyCards([
      { uid: 5, kind: "todos", x: 24, y: 344, w: 330, h: 304, tier: M },
      { uid: 6, kind: "todos", x: 380, y: 344, w: 330, h: 304, tier: M },
      { uid: 7, kind: "todos", x: 726, y: 344, w: 330, h: 304, tier: M },
    ]);
    /* 视觉最靠前的那张旧待办变成时间线（同类之间才看 y/x），第二张变成事项管理，第三张丢弃 */
    expect(rects(cards)).toEqual([
      ["timeline", 5, 24, 344, 330, 304, M],
      ["manage", 6, 380, 344, 330, 304, M],
    ]);
  });
});
