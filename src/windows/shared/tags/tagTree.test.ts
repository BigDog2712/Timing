import { describe, expect, it } from 'vitest';

import {
  buildTagTree,
  collectTagPaths,
  filterTagTree,
  flattenTagTree,
  isTagSameOrChild,
  parentTagPath,
  tagLeafName,
} from './tagTree';

describe('标签树', () => {
  it('补出中间层：只有 学习/考公 时 学习 也要出现', () => {
    const tree = buildTagTree([{ path: '学习/考公', count: 2 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.path).toBe('学习');
    expect(tree[0]!.count).toBe(0);
    expect(tree[0]!.totalCount).toBe(2);
    expect(tree[0]!.children[0]!.path).toBe('学习/考公');
    expect(tree[0]!.children[0]!.depth).toBe(1);
  });

  it('同级按显示名排序，多级合计算进父节点', () => {
    const tree = buildTagTree([
      { path: '娱乐/燕云', count: 3 },
      { path: '工作', count: 1 },
      { path: '娱乐/影视', count: 2 },
    ]);
    expect(tree.map((node) => node.name)).toContain('工作');
    const fun = tree.find((node) => node.path === '娱乐')!;
    expect(fun.totalCount).toBe(5);
    expect(fun.children.map((child) => child.name)).toEqual(['燕云', '影视']);
  });

  it('同一路径重复出现时按数量累加，不重复建节点', () => {
    const tree = buildTagTree([
      { path: '工作', count: 1 },
      { path: '工作', count: 2 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.count).toBe(3);
  });

  it('空路径与空白路径被忽略', () => {
    expect(buildTagTree([{ path: '', count: 1 }, { path: '  ', count: 1 }])).toEqual([]);
  });

  it('展开 / 收起决定拍平后的行数', () => {
    const tree = buildTagTree([{ path: '学习/考公', count: 1 }]);
    expect(flattenTagTree(tree, () => false)).toHaveLength(1);
    expect(flattenTagTree(tree, () => true)).toHaveLength(2);
    expect(collectTagPaths(tree)).toEqual(['学习', '学习/考公']);
  });

  it('搜索保留命中的子孙，父节点跟着留下', () => {
    const tree = buildTagTree([
      { path: '学习/考公', count: 1 },
      { path: '工作/周报', count: 1 },
    ]);
    const filtered = filterTagTree(tree, '考公');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.path).toBe('学习');
    expect(collectTagPaths(filtered)).toEqual(['学习', '学习/考公']);
  });
});

describe('路径工具', () => {
  it('父子判定覆盖自身与子树，且大小写不敏感', () => {
    expect(isTagSameOrChild('学习', '学习')).toBe(true);
    expect(isTagSameOrChild('学习/考公', '学习')).toBe(true);
    expect(isTagSameOrChild('学习/考公', '学')).toBe(false);
    expect(isTagSameOrChild('Study/Rust', 'study')).toBe(true);
    expect(isTagSameOrChild('学习', '')).toBe(false);
  });

  it('父路径与末段', () => {
    expect(parentTagPath('a/b/c')).toBe('a/b');
    expect(parentTagPath('a')).toBeNull();
    expect(tagLeafName('学习/考公')).toBe('考公');
    expect(tagLeafName('学习')).toBe('学习');
  });
});
