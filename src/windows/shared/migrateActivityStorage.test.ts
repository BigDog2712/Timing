/**
 * `migrateActivityStorage` 的搬迁语义单测（施工单 §8 M-1…M-5 / M-10a / M-10b / M-11）
 * -----------------------------------------------------------------------------
 * 全部用**假注册表 + 假 storage**（S2：不必起真 localStorage），因为迁移模块
 * **不 import 注册表**（判据 5 / V-12）——这正好让"给什么槽就搬什么槽"可以被任意构造。
 *
 * 每条用例对应一种"静默丢数据"的入口；M-10a / M-10b 的分工见文件内注释——
 * **M-10a 单独存在时会漏**："先删后写"的最终态看起来完全正确，只有
 * "新值已写 ⇒ 老值必须仍在"（M-10b）才把顺序变成不可违反。
 */
import { describe, expect, it } from 'vitest';

import { migrateActivityStorage } from './migrateActivityStorage';
import type { ActivitySlot } from './migrateActivityStorage';

/** jsdom 无关的最小 Storage 假件：Map + Storage 接口的迁移用得到的子集。 */
class FakeStorage {
  private readonly map = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.map.set(key, value);
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** 造 n 个带 target 的假槽（M-1 要 20 个，对齐真实账目）。 */
function makeSlots(count: number, withTarget = true): ActivitySlot[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `slot${i}`,
    legacy: `patina:key-${i}`,
    ...(withTarget ? { target: `activity:key-${i}` } : {}),
    lifetime: 'preference' as const,
  }));
}

describe('M-1 · 基本搬运：老键 → 新键（20 槽账目）', () => {
  const slots = makeSlots(20);

  it('只有老键 ⇒ 读出新值（迁移已复制）', () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) seed[`patina:key-${i}`] = `value-${i}`;
    const storage = new FakeStorage(seed);
    const report = migrateActivityStorage(slots, storage as unknown as Storage);
    expect(report.copied).toBe(20);
    for (let i = 0; i < 20; i += 1) {
      expect(storage.getItem(`activity:key-${i}`)).toBe(`value-${i}`);
    }
  });

  it('两者都有 ⇒ 读新值（迁移不覆盖）', () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      seed[`patina:key-${i}`] = `old-${i}`;
      seed[`activity:key-${i}`] = `new-${i}`;
    }
    const storage = new FakeStorage(seed);
    const report = migrateActivityStorage(slots, storage as unknown as Storage);
    expect(report.skipped).toBe(20);
    for (let i = 0; i < 20; i += 1) {
      expect(storage.getItem(`activity:key-${i}`)).toBe(`new-${i}`);
    }
  });

  it('都没有 ⇒ 迁移不建键（读侧得 null）', () => {
    const storage = new FakeStorage();
    const report = migrateActivityStorage(slots, storage as unknown as Storage);
    expect(report.copied).toBe(0);
    for (let i = 0; i < 20; i += 1) {
      expect(storage.getItem(`activity:key-${i}`)).toBeNull();
    }
  });
});

describe('M-2 · 新键已存在时迁移不覆盖', () => {
  it('新键的原样保留，老键也不删（永不删老）', () => {
    const storage = new FakeStorage({
      'patina:one': 'old-value',
      'activity:one': 'user-value',
    });
    const report = migrateActivityStorage(
      [{ name: 'one', legacy: 'patina:one', target: 'activity:one', lifetime: 'preference' }],
      storage as unknown as Storage,
    );
    expect(report.skipped).toBe(1);
    expect(storage.getItem('activity:one')).toBe('user-value');
    expect(storage.getItem('patina:one')).toBe('old-value');
  });
});

describe('M-3 · 动态模板：4 个已知格式 + 未知第 5 个（前缀回退）', () => {
  const known = ['csv', 'sqlite', 'parquet', 'markdown'] as const;

  function registry(): ActivitySlot[] {
    return [
      ...known.map((format) => ({
        name: `exportFields${format}`,
        legacy: `patina:export-fields:${format}`,
        target: `activity:export-fields:${format}`,
        lifetime: 'preference' as const,
      })),
      {
        name: 'exportFieldsTemplate',
        legacy: 'patina:export-fields:',
        target: 'activity:export-fields:',
        lifetime: 'preference',
        dynamic: true,
      },
    ];
  }

  it('4 个已知值 + 未知第 5 个格式都被搬到新前缀', () => {
    const seed: Record<string, string> = {
      'patina:export-fields:csv': '["a"]',
      'patina:export-fields:sqlite': '["b"]',
      'patina:export-fields:parquet': '["c"]',
      'patina:export-fields:markdown': '["d"]',
      /* 注册表建成之后才出现的格式：没有静态槽，只有前缀回退能救它。 */
      'patina:export-fields:yaml': '["e"]',
    };
    const storage = new FakeStorage(seed);
    migrateActivityStorage(registry(), storage as unknown as Storage);
    for (const format of known) {
      expect(storage.getItem(`activity:export-fields:${format}`)).toBe(seed[`patina:export-fields:${format}`]);
    }
    expect(storage.getItem('activity:export-fields:yaml')).toBe('["e"]');
    /* 老键一个都不删（INV-1）。 */
    for (const key of Object.keys(seed)) expect(storage.getItem(key)).not.toBeNull();
  });

  it('已知格式的新键已存在 ⇒ 枚举回退不覆盖（幂等）', () => {
    const storage = new FakeStorage({
      'patina:export-fields:csv': 'old',
      'activity:export-fields:csv': 'user',
    });
    const report = migrateActivityStorage(registry(), storage as unknown as Storage);
    expect(storage.getItem('activity:export-fields:csv')).toBe('user');
    expect(report.skipped).toBeGreaterThanOrEqual(1);
  });
});

describe('M-4 · 存储抛异常 ⇒ failed 计数、绝不抛出', () => {
  class ThrowingStorage extends FakeStorage {
    constructor(
      seed: Record<string, string>,
      private readonly failOnGet: (key: string) => boolean,
    ) {
      super(seed);
    }

    override getItem(key: string): string | null {
      if (this.failOnGet(key)) throw new Error('storage denied');
      return super.getItem(key);
    }
  }

  it('单槽 getItem 抛 ⇒ failed=1，其余槽照常搬', () => {
    const slots = makeSlots(5);
    const seed: Record<string, string> = {};
    for (let i = 0; i < 5; i += 1) seed[`patina:key-${i}`] = `v${i}`;
    const storage = new ThrowingStorage(seed, (key) => key === 'patina:key-2');
    /* try/catch 而不是 expect(fn).not.toThrow()：闭包赋值会被 TS 收窄成 never（TS5.5+），
     * 且异常本身要被显式再抛——迁移吞错绝不等于测试吞错。 */
    let report: ReturnType<typeof migrateActivityStorage>;
    try {
      report = migrateActivityStorage(slots, storage as unknown as Storage);
    } catch (error) {
      throw new Error(`migrateActivityStorage threw: ${String(error)}`);
    }
    expect(report.failed).toBe(1);
    expect(report.copied).toBe(4);
    expect(storage.getItem('activity:key-2')).toBeNull();
  });

  it('整体失败（每次访问都抛）⇒ 全部计入 failed，不抛', () => {
    const storage = new ThrowingStorage({}, () => true);
    const report = migrateActivityStorage(makeSlots(3), storage as unknown as Storage);
    expect(report.failed).toBe(3);
  });
});

describe('M-5 · 报告三项之和 == 扫描槽数（不静默少扫）', () => {
  it('纯静态槽：copied + skipped + failed === scanned', () => {
    const slots = makeSlots(20);
    const seed: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) seed[`patina:key-${i}`] = `v${i}`;
    const report = migrateActivityStorage(slots, new FakeStorage(seed) as unknown as Storage);
    expect(report.scanned).toBe(20);
    expect(report.copied + report.skipped + report.failed).toBe(report.scanned);
  });
});

describe('M-10a · 中断安全：任一中断点，有老值的键仍能读出', () => {
  class InterruptingStorage extends FakeStorage {
    private writes = 0;

    constructor(
      seed: Record<string, string>,
      private readonly failAfterWrites: number,
    ) {
      super(seed);
    }

    override setItem(key: string, value: string): void {
      this.writes += 1;
      if (this.writes > this.failAfterWrites) throw new Error('interrupted');
      super.setItem(key, value);
    }
  }

  it('在第 1 / 7 / 19 次写入后中断：每个有老值的槽，新键或老键仍可读', () => {
    /* 19 而不是 20：20 个槽全部写完就不算"中断"了——那只会证明绿，证明不了闸。 */
    for (const failAfter of [1, 7, 19]) {
      const slots = makeSlots(20);
      const seed: Record<string, string> = {};
      for (let i = 0; i < 20; i += 1) seed[`patina:key-${i}`] = `v${i}`;
      const storage = new InterruptingStorage(seed, failAfter);
      let report: ReturnType<typeof migrateActivityStorage>;
      try {
        report = migrateActivityStorage(slots, storage as unknown as Storage);
      } catch (error) {
        throw new Error(`中断点 ${failAfter} · migrateActivityStorage threw: ${String(error)}`);
      }
      expect(report.failed).toBeGreaterThan(0);
      for (let i = 0; i < 20; i += 1) {
        const readable = storage.getItem(`activity:key-${i}`) ?? storage.getItem(`patina:key-${i}`);
        expect(readable, `中断点 ${failAfter} · 槽 ${i}`).toBe(`v${i}`);
      }
    }
  });
});

describe('M-10b · 顺序断言：第 k 个键已写新值 ⇒ 第 k 个键旧值必须仍在', () => {
  /**
   * 在**写入边界**上检查不变式：`setItem(target)` 发生的那一刻，`legacy` 必须还在。
   * 违例**记录**而不是抛——迁移的逐槽 catch 会把抛出吞成 failed，测试就看不见了。
   * V-6（"先删后写"）注入后：删老在写新之前 ⇒ 写入时刻 legacy 已不在 ⇒ 违例非空 ⇒ 红。
   */
  it('每次 setItem(target) 时，同槽老键仍在', () => {
    const slots = makeSlots(6);
    const seed: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) seed[`patina:key-${i}`] = `v${i}`;
    const storage = new FakeStorage(seed);
    const violations: string[] = [];
    const instrumented: Storage = {
      get length() {
        return storage.length;
      },
      key: (index) => storage.key(index),
      clear: () => undefined,
      getItem: (key) => storage.getItem(key),
      removeItem: (key) => storage.removeItem(key),
      setItem: (key, value) => {
        const slot = slots.find((candidate) => candidate.target === key);
        if (slot && storage.getItem(slot.legacy) === null) violations.push(slot.name);
        storage.setItem(key, value);
      },
    };
    migrateActivityStorage(slots, instrumented);
    expect(violations, '违例槽').toEqual([]);
    expect(storage.length).toBe(12);
  });
});

describe('M-11 · 同键迁移两次 ⇒ 结果等于一次（多窗 / 同 profile 并发）', () => {
  it('第二轮全部 skip，终态不变', () => {
    const slots = makeSlots(8);
    const seed: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) seed[`patina:key-${i}`] = `v${i}`;
    const storage = new FakeStorage(seed) as unknown as Storage;
    const first = migrateActivityStorage(slots, storage);
    expect(first.copied).toBe(8);
    const second = migrateActivityStorage(slots, storage);
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(8);
    for (let i = 0; i < 8; i += 1) expect(storage.getItem(`activity:key-${i}`)).toBe(`v${i}`);
  });
});
