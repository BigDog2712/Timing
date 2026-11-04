import { describe, expect, it } from 'vitest';
import {
  clampMoyuMinutes,
  clampRecentCount,
  MOYU_DEFAULT_MINUTES,
  MOYU_MAX_MINUTES,
  MOYU_MIN_MINUTES,
  MOYU_NAME_MAX_LEN,
  moveMoyuPreset,
  normalizeMoyuPresets,
  pinnedItems,
  recentItems,
  RECENT_ITEMS_DEFAULT,
  RECENT_ITEMS_MAX,
  RECENT_ITEMS_MIN,
} from './moyu';
import type { Item, MoyuPreset } from '../types/domain';

describe('clampMoyuMinutes', () => {
  it('保持区间内的整数不变', () => {
    expect(clampMoyuMinutes(25)).toBe(25);
    expect(clampMoyuMinutes(MOYU_MIN_MINUTES)).toBe(1);
    expect(clampMoyuMinutes(MOYU_MAX_MINUTES)).toBe(1440);
  });

  it('低于下界夹到 1 分钟', () => {
    expect(clampMoyuMinutes(0)).toBe(MOYU_MIN_MINUTES);
    expect(clampMoyuMinutes(-30)).toBe(MOYU_MIN_MINUTES);
  });

  it('高于上界夹到 1440 分钟', () => {
    expect(clampMoyuMinutes(MOYU_MAX_MINUTES + 1)).toBe(MOYU_MAX_MINUTES);
    expect(clampMoyuMinutes(99999)).toBe(MOYU_MAX_MINUTES);
  });

  it('四舍五入到整分钟', () => {
    expect(clampMoyuMinutes(25.4)).toBe(25);
    expect(clampMoyuMinutes(25.6)).toBe(26);
  });

  it('非有限数回落到默认时长', () => {
    expect(clampMoyuMinutes(Number.NaN)).toBe(MOYU_DEFAULT_MINUTES);
    expect(clampMoyuMinutes(Number.POSITIVE_INFINITY)).toBe(MOYU_DEFAULT_MINUTES);
  });
});

describe('clampRecentCount', () => {
  it('保持在 1..10', () => {
    expect(clampRecentCount(3)).toBe(3);
    expect(clampRecentCount(0)).toBe(RECENT_ITEMS_MIN);
    expect(clampRecentCount(99)).toBe(RECENT_ITEMS_MAX);
  });

  it('非有限数回落默认 5', () => {
    expect(clampRecentCount(Number.NaN)).toBe(RECENT_ITEMS_DEFAULT);
  });
});

const preset = (id: string, item: string, minutes = 10, mode: MoyuPreset['mode'] = 'countdown'): MoyuPreset => ({
  id,
  item,
  minutes,
  mode,
});

describe('normalizeMoyuPresets', () => {
  it('丢掉空名并 trim', () => {
    const out = normalizeMoyuPresets([preset('a', '   '), preset('b', '  刷手机  ')]);
    expect(out).toHaveLength(1);
    expect(out[0].item).toBe('刷手机');
  });

  it('名称截断到 40 字符', () => {
    const out = normalizeMoyuPresets([preset('a', '字'.repeat(MOYU_NAME_MAX_LEN + 3))]);
    expect(out[0].item).toHaveLength(MOYU_NAME_MAX_LEN);
  });

  it('分钟越界被钳制', () => {
    const out = normalizeMoyuPresets([preset('a', '短', 0), preset('b', '长', 9999)]);
    expect(out[0].minutes).toBe(MOYU_MIN_MINUTES);
    expect(out[1].minutes).toBe(MOYU_MAX_MINUTES);
  });

  it('空 id / 重复 id 会被补齐', () => {
    const out = normalizeMoyuPresets([preset('', '甲'), preset('x', '乙'), preset('x', '丙')]);
    expect(new Set(out.map((p) => p.id)).size).toBe(3);
  });
});

describe('moveMoyuPreset', () => {
  const list = [preset('a', '甲'), preset('b', '乙'), preset('c', '丙')];

  it('上移 / 下移各一格', () => {
    expect(moveMoyuPreset(list, 1, -1).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(moveMoyuPreset(list, 1, 1).map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('越界原样返回（且不改原数组）', () => {
    expect(moveMoyuPreset(list, 0, -1).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(moveMoyuPreset(list, 2, 1).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

function item(id: number, name: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    name,
    color: null,
    status: 'active',
    isSystem: false,
    sortOrder: id,
    remindAt: null,
    remindedAt: null,
    isPinned: false,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe('pinnedItems / recentItems', () => {
  const items = [
    item(1, '未归类', { isSystem: true, updatedAt: 999 }),
    item(2, '置顶甲', { isPinned: true, updatedAt: 500 }),
    item(3, '旧事项', { updatedAt: 100 }),
    item(4, '新事项', { updatedAt: 900 }),
    item(5, '中间', { updatedAt: 600 }),
  ];

  it('置顶只取非系统的 isPinned', () => {
    expect(pinnedItems(items).map((i) => i.name)).toEqual(['置顶甲']);
  });

  it('最近编辑按 updatedAt 倒序、排除系统与置顶、取前 N 条', () => {
    expect(recentItems(items, 2).map((i) => i.name)).toEqual(['新事项', '中间']);
    expect(recentItems(items, 10).map((i) => i.name)).toEqual(['新事项', '中间', '旧事项']);
  });

  it('条数入参越界时按 1..10 钳制', () => {
    expect(recentItems(items, 0)).toHaveLength(1);
  });
});
