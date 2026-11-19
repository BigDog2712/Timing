/**
 * 标签树 —— 把「扁平路径」折成层级（唯一实现，两窗共用）
 * -----------------------------------------------------------------------------
 * 标签的真相是**路径**（`学习/考公`），层级只是读法。这里不做树表、不改数据，
 * 只在一处回答三个问题：
 *   1. 给定「路径 → 引用数」，树的形状是什么（含中间层：只有 `学习/考公` 时
 *      `学习` 也必须出现，否则一级父节点在界面上凭空消失）；
 *   2. 排序（同级按显示名 `localeCompare(zh-CN)`，父母与子女的相对顺序稳定）；
 *   3. 改名 / 删除时的前缀判定（`学习` 动的是 `学习` 与 `学习/**`）。
 *
 * 为什么必须只有一份：数据页的标签管理、AI 建标签时的候选、事项编辑器的补全
 * 都在读同一棵树。三处各写一遍 `split('/')`，迟早有一处把「中间层」漏掉，
 * 表现为「树里少一个父节点」——不报错，只是看起来标签丢了。
 */

/** 标签树的一个节点（`path` 是完整路径，`name` 是末段） */
export interface TagNode {
  path: string;
  name: string;
  /** 0 = 一级；与路径里的层数一致（`a/b/c` 的 `c` 是 2） */
  depth: number;
  /** 直接挂在这个路径上的对象数 */
  count: number;
  /** 含全部子孙的合计 */
  totalCount: number;
  children: TagNode[];
}

export interface TagCountEntry {
  path: string;
  count: number;
}

/** 路径前缀判定：`path` 是否等于 `ancestor` 或在其子树内（大小写不敏感）。 */
export function isTagSameOrChild(path: string, ancestor: string): boolean {
  const target = path.trim().toLocaleLowerCase('en-US');
  const parent = ancestor.trim().toLocaleLowerCase('en-US');
  if (!parent) return false;
  return target === parent || target.startsWith(`${parent}/`);
}

/** 父路径；一级返回 null。`a/b/c` → `a/b`。 */
export function parentTagPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index <= 0 ? null : path.slice(0, index);
}

/** 末段显示名（`学习/考公` → `考公`）。 */
export function tagLeafName(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/**
 * 折成树。**中间层自动补出来**（`count` 为 0），同一路径重复出现按 `count` 累加。
 * 返回值按同级 `name` 排序，兄弟之间的相对顺序稳定（不随输入顺序抖动）。
 */
export function buildTagTree(entries: readonly TagCountEntry[]): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const ensure = (path: string): TagNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const segments = path.split('/');
    const node: TagNode = {
      path,
      name: segments[segments.length - 1] ?? path,
      depth: segments.length - 1,
      count: 0,
      totalCount: 0,
      children: [],
    };
    nodes.set(path, node);
    if (node.depth > 0) {
      const parent = ensure(parentTagPath(path) ?? path);
      if (!parent.children.includes(node)) parent.children.push(node);
    }
    return node;
  };

  for (const entry of entries) {
    const path = entry.path.trim();
    if (!path) continue;
    const node = ensure(path);
    node.count += Math.max(0, entry.count);
  }

  const roots = [...nodes.values()].filter((node) => node.depth === 0);
  const finalize = (node: TagNode): number => {
    node.children.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    node.totalCount = node.children.reduce((sum, child) => sum + finalize(child), node.count);
    return node.totalCount;
  };
  roots.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  for (const root of roots) finalize(root);
  return roots;
}

/** 先序展开成一行一条（`depth` 供缩进）。`isExpanded` 返回 false 的节点不带子孙。 */
export function flattenTagTree(
  nodes: readonly TagNode[],
  isExpanded: (path: string) => boolean,
): TagNode[] {
  const out: TagNode[] = [];
  const walk = (list: readonly TagNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && isExpanded(node.path)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** 全部路径（树里的每一个节点，包括补出来的中间层），用于补全与 AI 候选。 */
export function collectTagPaths(nodes: readonly TagNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly TagNode[]) => {
    for (const node of list) {
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** 按查询串过滤：命中自身或任一子孙命中都保留（父节点跟着留下，否则树断开）。 */
export function filterTagTree(nodes: readonly TagNode[], query: string): TagNode[] {
  const needle = query.trim().toLocaleLowerCase('en-US');
  if (!needle) return [...nodes];
  const matches = (node: TagNode): boolean =>
    node.path.toLocaleLowerCase('en-US').includes(needle);
  const prune = (list: readonly TagNode[]): TagNode[] =>
    list
      .map((node) => {
        const children = prune(node.children);
        if (!matches(node) && children.length === 0) return null;
        return { ...node, children };
      })
      .filter((node): node is TagNode => node !== null);
  return prune(nodes);
}
