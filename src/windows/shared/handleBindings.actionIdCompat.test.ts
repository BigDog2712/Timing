/**
 * 守卫：`patina.open` 这个**持久化动作 id** 不许被改名吃掉
 * -----------------------------------------------------------------------------
 * 它是去 Patina 化批次里**唯一故意保留**的品牌字样，理由不是舍不得改，而是危险量级不同：
 *
 *   · **键改名**（`timing.handles.v1`）：读不到 ⇒ 回落默认值 ⇒ 用户看得见「配置没了」，能重配。
 *   · **动作 id 改名**：读得到、但不认识 ⇒ `parseHandleBindings` 把该槽归一成 `null`
 *     ⇒ 药丸上那个槽变「无」；而 `saveHandleBindings` 是**先 parse 再写**，
 *     用户随后动任何一个**别的**槽，整张 null 之后的表就被写盘
 *     ⇒ 老值永久覆盖、不可恢复。全程零日志、零报错。
 *
 * 本文件不改产品代码，只把这条边界钉住：**它现在绿着**，意思就是
 * 「谁把 `handleCatalog.ts` 里那条 id 改了、又没在 `parseSlots` 加读时归一化，当场红」。
 *
 * 变异自证：把 `handleCatalog.ts` 的 `{ id: 'patina.open' }` 改成 `'activity.open'` ⇒
 * g1/g2/g3 三条全红（g1 说明「目录里认不出了」，g2/g3 说明「用户盘上的值被吃掉了」）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { HANDLE_ACTIONS, HANDLE_SLOTS } from './handleCatalog';
import type { HandleSlot } from './handleCatalog';
import { isKnownActionId, loadHandleBindings, saveHandleBindings } from './handleBindings';

const KEY = 'timing.handles.v1';

/**
 * **刻意写字面量，不从 `HANDLE_ACTIONS` 读。**
 * 这条断言钉的是「用户磁盘上已经存在的那个字符串」，从目录里读就等于用被测对象证明
 * 被测对象 —— 目录一改名，两边同时变，断言永远绿。
 */
const STORED_ID = 'patina.open';

function slotsWith(value: string | null): Record<HandleSlot, string | null> {
  const out = {} as Record<HandleSlot, string | null>;
  for (const slot of HANDLE_SLOTS) out[slot] = value;
  return out;
}

/** 造一份「老用户盘上真实存在过」的配置：两个不同形态里各留一个 `patina.open`。 */
function seedLegacyDoc(): void {
  const doc = {
    version: 1,
    forms: {
      dot: { enabled: false, slots: slotsWith(null) },
      half: { enabled: false, slots: { ...slotsWith(null), left: STORED_ID } },
      full: { enabled: true, slots: { ...slotsWith('note.list'), middle: STORED_ID } },
    },
  };
  localStorage.setItem(KEY, JSON.stringify(doc));
}

beforeEach(() => {
  localStorage.clear();
});

describe('动作 id 的磁盘契约（改名必须带读时迁移）', () => {
  it('g1_catalog_still_knows_the_stored_id', () => {
    expect(
      HANDLE_ACTIONS.some((action) => action.id === STORED_ID),
      `action 目录里已经没有 "${STORED_ID}"：它进了用户的 localStorage，改名必须同时给 ` +
        'parseSlots 加读时归一化（老 id → 新 id），否则老配置的槽位会静默变「无」',
    ).toBe(true);
    expect(
      isKnownActionId(STORED_ID),
      `isKnownActionId("${STORED_ID}") 为 false —— parseSlots 会把它归一成 null`,
    ).toBe(true);
  });

  it('g2_load_keeps_the_stored_id_as_a_bound_slot', () => {
    seedLegacyDoc();
    const loaded = loadHandleBindings();
    expect(loaded.half.slots.left, `读盘后 half.left 丢了 "${STORED_ID}"（被归一成 null）`).toBe(STORED_ID);
    expect(loaded.full.slots.middle, `读盘后 full.middle 丢了 "${STORED_ID}"（被归一成 null）`).toBe(STORED_ID);
  });

  it('g3_saving_another_slot_must_not_erase_the_stored_id', () => {
    seedLegacyDoc();
    const loaded = loadHandleBindings();

    /* 模拟设置页的真实写入路径（`SettingsHandlesPanel`）：只动 full.left，整份合并后保存。 */
    const merged = {
      ...loaded,
      full: { ...loaded.full, slots: { ...loaded.full.slots, left: 'today.panel' as string | null } },
    };
    saveHandleBindings(merged);

    const raw = localStorage.getItem(KEY) ?? '';
    expect(
      raw.includes(STORED_ID),
      `保存一次无关改动后，盘上已经没有 "${STORED_ID}" —— 这就是「先 parse 再写」的杀伤面：` +
        '识别不出 ⇒ 归一成 null ⇒ 写盘 ⇒ 用户的老值被永久覆盖，且没有任何报错',
    ).toBe(true);

    const reread = loadHandleBindings();
    expect(reread.full.slots.middle, '重新读盘后 full.middle 没保住').toBe(STORED_ID);
    expect(reread.half.slots.left, '重新读盘后 half.left 没保住').toBe(STORED_ID);
    expect(reread.full.slots.left, '本次真正改动的槽没生效（写入路径自身坏了）').toBe('today.panel');
  });
});
