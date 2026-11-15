/**
 * [0.13 · 需求 1.4] 布局库的判据（V-1.4a）。
 *
 * 要钉五件事，每一件坏掉都**不报错**、只表现为「用户的排布不见了」：
 *   ① 迁移：老「默认布局」键在、`library:v1` 不在 → 导入成 `items[0]` 并设为当前；
 *   ② 自愈：库那一键是坏 JSON / 形状不对 → 不抛、不白屏，回落到迁移或空库；
 *   ③ 删当前：`removeLayout(activeId)` → `activeId` 回落内置的 `factory`，
 *      **不猜**「用剩下的最近一条」；
 *   ④ 隔离：`upsert`（新建布局）存的是深拷贝，之后拖卡不改库里那一份；
 *   ⑤ 落盘稳定：迁移生成的 id 必须跨会话不变，否则「当前布局」每开一次窗就变成未选中。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cloneLayout, DEFAULT_LAYOUT } from "./defaultLayout";
import {
  createLayout,
  emptyLibrary,
  FACTORY_LAYOUT_ID,
  LIBRARY_STORAGE_KEY,
  libraryEntries,
  loadLibrary,
  removeLayout,
  resolveLayout,
  saveLibrary,
} from "./library";
import { DEFAULT_LAYOUT_STORAGE_KEY } from "./layoutStore";

const NOW = 1_700_000_000_000;

/** 一版手摆的布局：位置与出厂栅格都不同，一眼能分辨拿到的是哪版。 */
const CUSTOM = {
  ...DEFAULT_LAYOUT,
  nextId: 2,
  snap: false,
  cards: [{ uid: 1, kind: "notes" as const, x: 40, y: 128, w: 320, h: 168, tier: "M" as const }],
};

function storedDefault(layout = CUSTOM): void {
  window.localStorage.setItem(
    DEFAULT_LAYOUT_STORAGE_KEY,
    JSON.stringify({ ...layout, version: 3 }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("迁移（老「默认布局」键 → 布局库）", () => {
  it("v14a_legacy_default_key_is_migrated", () => {
    storedDefault();
    const { library, migrated } = loadLibrary({ now: NOW, migratedName: "布局 1" });

    expect(migrated).toBe(true);
    expect(library.items.length).toBe(1);
    expect(library.items[0].name).toBe("布局 1");
    expect(library.items[0].layout.cards).toEqual(CUSTOM.cards);
    expect(library.activeId).toBe(library.items[0].id);
    /* 老键**不删**：删了等于替人清数据（同 `layoutStore` 对 v2 键的纪律） */
    expect(window.localStorage.getItem(DEFAULT_LAYOUT_STORAGE_KEY)).not.toBeNull();
  });

  it("v14a_migration_id_survives_a_reload", () => {
    storedDefault();
    const first = loadLibrary({ now: NOW, migratedName: "布局 1" }).library;
    const second = loadLibrary({ now: NOW + 1, migratedName: "布局 1" }).library;

    expect(second.activeId).toBe(first.activeId);
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    /* 迁移落盘了：第二遍读的是库，不是又迁一遍 */
    expect(window.localStorage.getItem(LIBRARY_STORAGE_KEY)).not.toBeNull();
  });

  it("v14a_nothing_to_migrate_yields_an_empty_library_with_factory_active", () => {
    const { library, migrated } = loadLibrary({ now: NOW, migratedName: "布局 1" });
    expect(migrated).toBe(false);
    expect(library.items).toEqual([]);
    expect(library.activeId).toBe(FACTORY_LAYOUT_ID);
  });
});

describe("坏数据自愈", () => {
  it("v14a_broken_json_falls_back_without_throwing", () => {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, "{not json");
    expect(() => loadLibrary({ now: NOW, migratedName: "布局 1" })).not.toThrow();
    expect(loadLibrary({ now: NOW, migratedName: "布局 1" }).library.activeId)
      .toBe(FACTORY_LAYOUT_ID);
  });

  it("v14a_wrong_shape_and_unknown_active_id_fall_back_to_factory", () => {
    window.localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: 1, activeId: "gone", items: [{ id: "a", name: "A" }] }),
    );
    const { library } = loadLibrary({ now: NOW, migratedName: "布局 1" });
    /* 那条 layout 是坏的 → 整条被丢掉；activeId 指过去不存在 → factory */
    expect(library.items).toEqual([]);
    expect(library.activeId).toBe(FACTORY_LAYOUT_ID);
  });

  it("v14a_version_mismatch_is_ignored", () => {
    window.localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: 99, activeId: "a", items: [] }),
    );
    expect(loadLibrary({ now: NOW, migratedName: "布局 1" }).library.items).toEqual([]);
  });
});

describe("删当前布局 → 回落 factory（V-1.4a 的核心）", () => {
  it("v14a_removing_the_active_layout_falls_back_to_factory", () => {
    const created = createLayout(emptyLibrary(), "工作", CUSTOM, NOW);
    const lib = created.library;
    expect(lib.activeId).toBe(created.entry.id);

    const after = removeLayout(lib, created.entry.id);
    expect(after.items).toEqual([]);
    expect(after.activeId).toBe(FACTORY_LAYOUT_ID);
    /* 回落之后拿到的是**出厂排布**，不是空板 */
    expect(resolveLayout(after, after.activeId).cards).toEqual(DEFAULT_LAYOUT.cards);
  });

  it("v14a_removing_another_layout_keeps_the_active_one", () => {
    const a = createLayout(emptyLibrary(), "A", CUSTOM, NOW).library;
    const b = createLayout(a, "B", CUSTOM, NOW + 1).library;
    const keepId = b.items[0].id;

    const after = removeLayout(b, keepId);
    expect(after.items.length).toBe(1);
    expect(after.activeId).toBe(b.activeId);
  });

  it("v14a_removing_an_unknown_id_is_a_no_op", () => {
    const lib = createLayout(emptyLibrary(), "A", CUSTOM, NOW).library;
    expect(removeLayout(lib, "nope")).toBe(lib);
  });
});

describe("深拷贝隔离（改当前排布不影响库）", () => {
  it("v14a_upsert_stores_a_snapshot", () => {
    const current = cloneLayout(CUSTOM);
    const { library, entry } = createLayout(emptyLibrary(), "工作", current, NOW);

    /* 模拟「新建布局之后接着拖卡」：改当前排布那一份 */
    current.cards[0].x = 999;
    current.snap = true;

    expect(entry.layout.cards[0].x).toBe(40);
    expect(library.items[0].layout.cards[0].x).toBe(40);
    expect(library.items[0].layout.snap).toBe(false);
  });

  it("v14a_resolved_layout_is_a_copy_not_the_stored_object", () => {
    const { library } = createLayout(emptyLibrary(), "工作", CUSTOM, NOW);
    const resolved = resolveLayout(library, library.activeId);
    resolved.cards[0].x = 999;
    expect(library.items[0].layout.cards[0].x).toBe(40);
  });
});

describe("列表与 id", () => {
  it("v14a_entries_always_start_with_factory_and_carry_stored_names", () => {
    const lib = createLayout(emptyLibrary(), "工作", CUSTOM, NOW).library;
    const entries = libraryEntries(lib);
    expect(entries[0].id).toBe(FACTORY_LAYOUT_ID);
    expect(entries[1].id).toBe(lib.activeId);
    expect(entries[1].name).toBe("工作");
  });

  it("v14a_duplicate_names_are_allowed_and_ids_are_unique", () => {
    const a = createLayout(emptyLibrary(), "布局 1", CUSTOM, NOW).library;
    const b = createLayout(a, "布局 1", CUSTOM, NOW + 1).library;
    expect(b.items.map((item) => item.name)).toEqual(["布局 1", "布局 1"]);
    expect(new Set(b.items.map((item) => item.id)).size).toBe(2);
  });

  it("v14a_save_and_load_round_trip", () => {
    const lib = createLayout(emptyLibrary(), "工作", CUSTOM, NOW).library;
    saveLibrary(lib);
    const back = loadLibrary({ now: NOW + 5, migratedName: "布局 1" }).library;
    expect(back.activeId).toBe(lib.activeId);
    expect(back.items[0].layout.cards).toEqual(CUSTOM.cards);
  });
});
