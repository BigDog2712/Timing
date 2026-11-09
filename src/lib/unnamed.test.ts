/**
 * Timing — 「未命名这一笔」判据（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 三条都是纯函数，直接测行为，不读源码：
 *   1. 谁算"还没起名"（只看归属是不是系统事项）；
 *   2. 名字怎么规整（去空白 + 截上限，后端会拒超长）；
 *   3. "先找再建"的匹配口径（全等，不做模糊 —— 模糊会把两件事并成一条）。
 */
import { describe, expect, it } from 'vitest';
import { SYSTEM_ITEM_ID } from '../types/domain';
import type { Item } from '../types/domain';
import { NAME_MAX_LEN, isUnnamedRecord, matchItemByName, normalizeName } from './unnamed';

function item(id: number, name: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    name,
    color: null,
    status: 'active',
    isSystem: false,
    sortOrder: 0,
    remindAt: null,
    remindedAt: null,
    isPinned: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...extra,
  };
}

describe('isUnnamedRecord', () => {
  it('系统事项「未归类」上的记录算未命名', () => {
    expect(isUnnamedRecord({ itemId: SYSTEM_ITEM_ID })).toBe(true);
  });

  it('任何真实事项上的记录都不算', () => {
    expect(isUnnamedRecord({ itemId: 2 })).toBe(false);
    expect(isUnnamedRecord({ itemId: 99 })).toBe(false);
  });
});

describe('normalizeName', () => {
  it('去掉首尾空白', () => {
    expect(normalizeName('  写周报  ')).toBe('写周报');
  });

  it('超长按上限截断（后端会回 ITEM_NAME_TOO_LONG）', () => {
    const long = 'あ'.repeat(NAME_MAX_LEN + 20);
    expect(normalizeName(long)).toHaveLength(NAME_MAX_LEN);
  });

  it('全空白等于空名字', () => {
    expect(normalizeName('   ')).toBe('');
  });
});

describe('matchItemByName', () => {
  const items = [item(2, '写周报'), item(3, '写周报给老板'), item(4, ' 健身 ')];

  it('同名（哪怕多敲了空格）复用已有事项', () => {
    expect(matchItemByName(items, ' 写周报 ')?.id).toBe(2);
  });

  it('已经带空格的既有名字也能认出来', () => {
    expect(matchItemByName(items, '健身')?.id).toBe(4);
  });

  it('不做模糊匹配：长得像≠同一件事', () => {
    expect(matchItemByName(items, '写周报给')).toBeNull();
  });

  it('空名字不匹配任何东西（否则会把记录挂到随便一条上）', () => {
    expect(matchItemByName(items, '   ')).toBeNull();
  });
});
