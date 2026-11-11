/**
 * 手柄绑定归一化的单测（§3.4 的 7 条规则 + 两条迁移情形）
 * -----------------------------------------------------------------------------
 * 这一层最容易出的错不是「解析崩了」，而是**悄悄放行一个非法值**：
 * 用户手改坏配置 / 未来版本降级 / 动作被删之后残留 id —— 三种都会让药丸上出现
 * 一个点了没反应的槽位，而日志里什么都没有。所以每条规则都单独钉一个用例。
 *
 * 变异自证：把 `parseSlots` 里「未知 id → null」改成「原样保留」，
 * `r6_*` 与 `a04_*` 两个用例必红。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_FORMS,
  HANDLE_SLOTS,
} from './handleCatalog';
import type { HandleSlot } from './handleCatalog';
import {
  isKnownActionId,
  loadHandleBindings,
  parseHandleBindings,
  saveHandleBindings,
} from './handleBindings';

const KEY = 'timing.handles.v1';

/** 一份「三形态都启用 + 每个槽都绑第一个动作」的合法配置，供各用例裁剪。 */
function validDoc() {
  const slots = {} as Record<HandleSlot, string | null>;
  for (const slot of HANDLE_SLOTS) slots[slot] = 'note.list';
  return {
    version: 1,
    forms: {
      dot: { enabled: true, slots: { ...slots } },
      half: { enabled: true, slots: { ...slots } },
      full: { enabled: true, slots: { ...slots } },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('parseHandleBindings —— 非法输入一律回落默认，永不抛', () => {
  it('r1_non_object_become_defaults', () => {
    /* 规则 1：`null` / 字符串 / 数字 / 数组 都不是「配置」 */
    for (const raw of [null, undefined, 'not json', 42, [], true]) {
      expect(parseHandleBindings(raw)).toEqual(DEFAULT_HANDLE_BINDINGS);
    }
  });

  it('r2_unknown_version_falls_back_and_warns_once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = parseHandleBindings({ version: 2, forms: validDoc().forms });
    expect(out).toEqual(DEFAULT_HANDLE_BINDINGS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('r3_missing_form_uses_its_own_default_and_keeps_the_others', () => {
    /* 规则 3：只存了 dot / half（`full` 缺失）→ full 必须是「开 + 默认绑定」，
       而不是「关」—— 否则一次半写会把老用户的便利贴入口抹掉 */
    const doc = validDoc();
    const partial = { version: 1, forms: { dot: doc.forms.dot, half: doc.forms.half } };
    const out = parseHandleBindings(partial);
    expect(out.full).toEqual(DEFAULT_HANDLE_BINDINGS.full);
    expect(out.full.enabled).toBe(true);
    expect(out.dot.enabled).toBe(true);
    expect(out.dot.slots.right).toBe('note.list');
  });

  it('r4_non_boolean_enabled_uses_that_forms_default', () => {
    const doc = validDoc();
    const out = parseHandleBindings({
      version: 1,
      forms: { ...doc.forms, dot: { enabled: 'yes', slots: doc.forms.dot.slots } },
    });
    expect(out.dot.enabled).toBe(DEFAULT_HANDLE_BINDINGS.dot.enabled);
    /* 其余字段不受影响：坏一个字段不该连坐整形态 */
    expect(out.dot.slots.left).toBe('note.list');
  });

  it('r5_missing_or_non_string_slot_becomes_null', () => {
    const out = parseHandleBindings({
      version: 1,
      forms: {
        dot: { enabled: true, slots: { left: 'note.list', right: 42 } },
        half: { enabled: true },
        full: { enabled: true, slots: 'nope' },
      },
    });
    /* 5 个 key 必须都补齐：缺 key 是「无」，不是「保留旧值」也不是「崩溃」 */
    expect(Object.keys(out.dot.slots).sort()).toEqual([...HANDLE_SLOTS].sort());
    expect(out.dot.slots.left).toBe('note.list');
    expect(out.dot.slots.right).toBeNull();
    expect(out.half.slots.left).toBeNull();
    expect(out.full.slots.leftDouble).toBeNull();
  });

  it('r6_unknown_action_id_becomes_null_without_noise', () => {
    /* 规则 6：`note.deleted` 是「目录里已经没有这个动作」的典型残留。
       必须渲染成「无」（可被用户重绑），且不抛、不 console.error。 */
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = validDoc();
    const out = parseHandleBindings({
      version: 1,
      forms: {
        ...doc.forms,
        dot: { enabled: true, slots: { ...doc.forms.dot.slots, left: 'note.deleted' } },
      },
    });
    expect(out.dot.slots.left).toBeNull();
    expect(out.dot.slots.right).toBe('note.list');
    expect(error).not.toHaveBeenCalled();
  });

  it('r7_unknown_forms_are_ignored', () => {
    /* 规则 7：未来版本加了 `bubble`，老版本读到它必须静默忽略（不报错、不崩） */
    const doc = validDoc();
    const out = parseHandleBindings({
      version: 1,
      forms: { ...doc.forms, bubble: { enabled: true, slots: {} } },
    });
    expect(Object.keys(out).sort()).toEqual([...HANDLE_FORMS].sort());
    expect(out).not.toHaveProperty('bubble');
  });

  it('defaults_are_not_shared_by_reference', () => {
    /* 返回值必须是副本：调用方（设置页）就地改一格，不能污染出厂表 */
    const out = parseHandleBindings(null);
    out.full.slots.left = 'patina.open';
    out.full.enabled = false;
    expect(DEFAULT_HANDLE_BINDINGS.full.slots.left).toBe('note.current');
    expect(DEFAULT_HANDLE_BINDINGS.full.enabled).toBe(true);
  });
});

describe('loadHandleBindings —— 读坏不写盘', () => {
  it('no_key_yields_defaults', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadHandleBindings()).toEqual(DEFAULT_HANDLE_BINDINGS);
    /* X-03：读路径不许有任何写入 —— 一次读就凭空造出一个键，等于把「没配置」变成「配置了默认」 */
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('broken_json_yields_defaults_and_leaves_the_raw_value_alone', () => {
    localStorage.setItem(KEY, '{"version":1,"forms":');
    expect(loadHandleBindings()).toEqual(DEFAULT_HANDLE_BINDINGS);
    expect(localStorage.getItem(KEY)).toBe('{"version":1,"forms":');
  });

  it('a04_stored_unknown_id_is_read_as_no_binding', () => {
    /* 与 r6 同一条规则，但走真实读路径：老配置里的残留 id 读出来必须是「无」 */
    const doc = validDoc();
    doc.forms.full.slots.leftDouble = 'today.panel.legacy';
    localStorage.setItem(KEY, JSON.stringify(doc));
    expect(loadHandleBindings().full.slots.leftDouble).toBeNull();
  });

  it('x03_future_version_is_read_as_defaults_without_rewriting_the_key', () => {
    /* [QA 20261111 补] r2 只测了 `parse`；「版本不认识 → 回落默认**且不写盘**」这一条的
       后半（不覆盖用户原键）只能在读路径上验。缺了它，一次「降级读 + 顺手回写」就会把
       用户在新版本里配好的绑定永久洗成默认 —— 而且是最难追的一类数据丢失。 */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const future = JSON.stringify({ version: 2, forms: validDoc().forms });
    localStorage.setItem(KEY, future);
    expect(loadHandleBindings()).toEqual(DEFAULT_HANDLE_BINDINGS);
    expect(localStorage.getItem(KEY)).toBe(future);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('saveHandleBindings —— 落盘前先归一化', () => {
  it('save_writes_version_1_and_the_normalized_shape', () => {
    const doc = validDoc();
    /* 故意留一个非法值：写盘前必须被 parse 洗掉，不能把脏数据留在盘上 */
    doc.forms.dot.slots.left = 'note.deleted';
    saveHandleBindings(doc.forms);
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string);
    expect(stored.version).toBe(1);
    expect(Object.keys(stored.forms).sort()).toEqual([...HANDLE_FORMS].sort());
    expect(stored.forms.dot.slots.left).toBeNull();
  });

  it('round_trip_keeps_every_slot', () => {
    const doc = validDoc();
    saveHandleBindings(parseHandleBindings(doc));
    const back = loadHandleBindings();
    for (const form of HANDLE_FORMS) {
      expect(back[form].enabled).toBe(true);
      for (const slot of HANDLE_SLOTS) expect(back[form].slots[slot]).toBe('note.list');
    }
  });
});

describe('isKnownActionId —— 与目录同一口径', () => {
  it('knows_registry_ids_and_rejects_others', () => {
    expect(isKnownActionId('today.panel')).toBe(true);
    expect(isKnownActionId('timer.stop')).toBe(true);
    expect(isKnownActionId('today.panel.legacy')).toBe(false);
    expect(isKnownActionId('')).toBe(false);
  });
});

describe('出厂绑定 = 设计 §3.3 的逐格表（QA 20261111 补）', () => {
  /**
   * 为什么要把整张表抄一遍：这张表是**用户第一眼看到的三形态行为**，也是「删掉今天图标、
   * 把它的功能变成可绑定动作」这条需求的落点。没有它，`DEFAULT_HANDLE_BINDINGS` 里任何
   * 一格被顺手改掉都不会有测试红——而症状只是「某个手柄的某一下点了没反应」。
   * 抄字面量是故意的：被测值与期望值不能读同一份数据。
   */
  const TABLE: Record<string, [boolean, string[], string[]]> = {
    /* 形态: [默认开?, 左键/右键/中键, 左双击/右双击] */
    dot: [false, ['today.panel', 'today.digest', '—'], ['—', '—']],
    half: [false, ['patina.open', 'todos.open', '—'], ['—', '—']],
    full: [true, ['note.current', 'note.list', '—'], ['today.panel', 'today.digest']],
  };

  it('a02_defaults_match_the_design_table_cell_by_cell', () => {
    const NONE = null;
    const expectMap = (form: 'dot' | 'half' | 'full') => {
      const [enabled, single, double] = TABLE[form];
      expect(DEFAULT_HANDLE_BINDINGS[form].enabled, `${form}.enabled`).toBe(enabled);
      expect([
        DEFAULT_HANDLE_BINDINGS[form].slots.left,
        DEFAULT_HANDLE_BINDINGS[form].slots.right,
        DEFAULT_HANDLE_BINDINGS[form].slots.middle,
      ]).toEqual(single.map((id) => (id === '—' ? NONE : id)));
      expect([
        DEFAULT_HANDLE_BINDINGS[form].slots.leftDouble,
        DEFAULT_HANDLE_BINDINGS[form].slots.rightDouble,
      ]).toEqual(double.map((id) => (id === '—' ? NONE : id)));
      /* 每个形态恰好 5 个槽，一个不多一个不少（A-01） */
      expect(Object.keys(DEFAULT_HANDLE_BINDINGS[form].slots)).toHaveLength(5);
    };
    expectMap('dot');
    expectMap('half');
    expectMap('full');
  });

  it('a02_only_the_full_handle_is_on_by_default', () => {
    /* 三个全开等于一上来就摆三个可点区域；全关等于老用户升级后失去便利贴入口 */
    expect(HANDLE_FORMS.filter((form) => DEFAULT_HANDLE_BINDINGS[form].enabled)).toEqual(['full']);
  });

  it('a04_every_default_id_exists_in_the_catalog', () => {
    /* 出厂值里写一个目录中不存在的 id → 药丸上会出现一个「点了没反应」的槽位，
       而归一化会把它洗成 null：症状与「用户从没绑过」完全一样，没有任何线索。 */
    for (const form of HANDLE_FORMS) {
      for (const slot of HANDLE_SLOTS) {
        const id = DEFAULT_HANDLE_BINDINGS[form].slots[slot];
        if (id === null) continue;
        expect(isKnownActionId(id), `${form}.${slot} = ${id}`).toBe(true);
      }
    }
  });
});
