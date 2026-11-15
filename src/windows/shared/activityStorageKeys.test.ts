/**
 * 注册表一致性 + 出口惰性的单测（施工单 §8 M-13 / M-14 / M-15 与 §2 S1 的账目证明）
 * -----------------------------------------------------------------------------
 * 账目是**写死常量**（不用 `>=`）：24 槽 = 20 个带 `target` + 4 个只读老键。
 * 用 `>=` 会把"少建一槽"也放过去——账目错位本身就是静默丢数据的前兆。
 *
 * M-13 / M-14 / M-15 是"惰性"唯一的能红证明：每个用例都 `vi.resetModules()` +
 * 动态 import，拿一份**全新的模块状态**（`migrationState` 是模块级单例，不重置
 * 就会被前一个用例置成 done，惰性根本没被测到）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTIVITY_KEY_TEMPLATES,
  ACTIVITY_SLOT_RECORD,
  ACTIVITY_SLOTS,
} from './activityStorageKeys';
import type { ActivitySlotName } from './activityStorageKeys';

/** 账目常量（施工单已定 #9：写死，不用 `>=`）。 */
const TOTAL_SLOTS = 24;
const COPY_SLOTS = 20;
const READ_ONLY_LEGACY_SLOTS = 4;

beforeEach(() => {
  window.localStorage.clear();
});

/** 拿一份 migrationState 归零的模块实例（vi.resetModules + 动态 import）。 */
async function freshKeys() {
  vi.resetModules();
  return await import('./activityStorageKeys');
}

describe('注册表账目（S1）', () => {
  it('槽数 == 24（防空转下限 15，但账目是精确相等）', () => {
    expect(ACTIVITY_SLOTS.length).toBe(TOTAL_SLOTS);
    expect(ACTIVITY_SLOTS.length).toBeGreaterThanOrEqual(15);
  });

  it('带 target 的槽 == 20、只读老键 == 4（写死常量，不用 >=）', () => {
    const copySlots = ACTIVITY_SLOTS.filter((slot) => slot.target !== undefined);
    const readOnly = ACTIVITY_SLOTS.filter((slot) => slot.target === undefined);
    expect(copySlots.length).toBe(COPY_SLOTS);
    expect(readOnly.length).toBe(READ_ONLY_LEGACY_SLOTS);
    expect(readOnly.map((slot) => slot.name).sort()).toEqual(
      ['boardLayoutV2', 'destinationDetailMinSecsLegacy', 'destinationDetailZoomHoursLegacy', 'historyTimelineMode'].sort(),
    );
  });

  it('lifetime 由 Record 保证穷尽；transient 只有 pendingUpdateRelaunchView', () => {
    const names = Object.keys(ACTIVITY_SLOT_RECORD) as ActivitySlotName[];
    expect(names.length).toBe(TOTAL_SLOTS);
    for (const name of names) {
      const slot = ACTIVITY_SLOT_RECORD[name];
      expect(slot.lifetime === 'preference' || slot.lifetime === 'transient', `${name} 的 lifetime`).toBe(true);
      expect(slot.name, 'Record 键与槽的 name 必须一致').toBe(name);
    }
    const transient = ACTIVITY_SLOTS.filter((slot) => slot.lifetime === 'transient').map((slot) => slot.name);
    expect(transient).toEqual(['pendingUpdateRelaunchView']);
  });

  it('每个槽的 legacy 非空且全仓唯一（含动态模板）；命名前缀符合 patina: / patina. 点号键', () => {
    const all = [...ACTIVITY_SLOTS, ...ACTIVITY_KEY_TEMPLATES];
    const keys = all.flatMap((slot) => [slot.legacy, ...(slot.target ? [slot.target] : [])]);
    for (const key of keys) expect(key.length, '空键').toBeGreaterThan(0);
    expect(new Set(keys).size, '键必须两两不同').toBe(keys.length);
    for (const slot of ACTIVITY_SLOTS) {
      const isDotKey = slot.legacy.startsWith('patina.');
      expect(
        slot.legacy.startsWith('patina:') || isDotKey,
        `${slot.name} 的 legacy 前缀`,
      ).toBe(true);
      if (slot.target !== undefined) {
        const targetIsDotKey = slot.target.startsWith('activity.');
        expect(
          slot.target.startsWith('activity:') || targetIsDotKey,
          `${slot.name} 的 target 前缀`,
        ).toBe(true);
        expect(slot.target.startsWith('patina'), '新键不得再带旧前缀').toBe(false);
      }
    }
    /* 点号键恰好 1 个（§3.4）。 */
    expect(ACTIVITY_SLOTS.filter((slot) => slot.legacy.startsWith('patina.')).length).toBe(1);
  });
});

describe('M-13 · 出口惰性：不 import 任何 entry，直接读 ⇒ 迁移已发生', () => {
  it('第一次读拿到老值，且新键已写入', async () => {
    window.localStorage.setItem('patina:dashboard-zoom:v1', '1.35');
    const { readActivityKey } = await freshKeys();
    expect(readActivityKey('boardZoom')).toBe('1.35');
    expect(window.localStorage.getItem('activity:dashboard-zoom:v1')).toBe('1.35');
    /* 老键不删（INV-1）。 */
    expect(window.localStorage.getItem('patina:dashboard-zoom:v1')).toBe('1.35');
  });

  it('第二次读 ⇒ 迁移不重跑（删掉新键后仍读 null，而不是被重跑复制回来）', async () => {
    window.localStorage.setItem('patina:dashboard-zoom:v1', '1.35');
    const { readActivityKey } = await freshKeys();
    expect(readActivityKey('boardZoom')).toBe('1.35');
    window.localStorage.removeItem('activity:dashboard-zoom:v1');
    window.localStorage.setItem('patina:dashboard-zoom:v1', '1.35');
    expect(readActivityKey('boardZoom')).toBeNull();
    expect(window.localStorage.getItem('activity:dashboard-zoom:v1')).toBeNull();
  });
});

describe('M-14 · 写出口也过闸', () => {
  it('预置老键 + 空新键 ⇒ 先写一个槽 ⇒ 其余槽已迁移，且被写槽不被迁移覆盖', async () => {
    window.localStorage.setItem('patina:dashboard-zoom:v1', '1.35');
    window.localStorage.setItem('patina:dashboard-layout:locked:v1', '0');
    const { writeActivityKey } = await freshKeys();
    expect(writeActivityKey('boardLocked', '1')).toBe(true);
    /* 迁移已经发生：另一个槽的老值已就位。 */
    expect(window.localStorage.getItem('activity:dashboard-zoom:v1')).toBe('1.35');
    /* 被写的那个槽：用户的写入赢，不是迁移复制来的 '0'。 */
    expect(window.localStorage.getItem('activity:dashboard-layout:locked:v1')).toBe('1');
    /* 老键照旧不删。 */
    expect(window.localStorage.getItem('patina:dashboard-layout:locked:v1')).toBe('0');
  });
});

describe('M-15 · 迁移完成后不回落老键（§4.6）', () => {
  it('读一次 → removeActivityKey → 再读得到 null（不是老值复活）', async () => {
    window.localStorage.setItem('patina:dashboard-zoom:v1', '1.35');
    const { readActivityKey, removeActivityKey } = await freshKeys();
    expect(readActivityKey('boardZoom')).toBe('1.35');
    expect(removeActivityKey('boardZoom')).toBe(true);
    expect(readActivityKey('boardZoom')).toBeNull();
    /* 老键仍在盘上（永不删）——但读路径不再看它。这条不写死，将来某个
       "统一读出口都走 legacy 回落"的重构就会让它原地复活。 */
    expect(window.localStorage.getItem('patina:dashboard-zoom:v1')).toBe('1.35');
  });
});

describe('只读老键槽（无 target）', () => {
  it('读它读的是老键本身，迁移不为其建新键', async () => {
    window.localStorage.setItem('patina:dashboard-layout:v2', '{"version":2}');
    const { readActivityKey } = await freshKeys();
    expect(readActivityKey('boardLayoutV2')).toBe('{"version":2}');
    expect(window.localStorage.getItem('activity:dashboard-layout:v2')).toBeNull();
  });
});
