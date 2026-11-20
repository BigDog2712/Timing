/**
 * 标签「拖动改分类」的判据（纯函数，不碰 DOM、不碰 IPC）
 * -----------------------------------------------------------------------------
 * 标签的真相是**路径**（`学习/考公`），所以「把一个标签拖到另一个标签下面」不是
 * 一次结构操作，而是**改路径**：`学习/考公` → `工作/考公`。整棵子树跟着走，后端
 * `rename_tag` 一个事务把事项上的引用与 `settings` 里的 `tag.def.*` 定义行一起改掉。
 *
 * 放在 shared 而不是组件里，只为一条：**发意图之前就要判**。后端 `require_tag_path`
 * 遇到越界的路径是「跳过这一条」而不是截断（改名宁可漏也不写坏），所以让用户拖完
 * 才发现「有一部分没生效」是最糟的失败形态 —— 必须在落手之前挡住。
 *
 * 判据的顺序是有意为之（先「根本不是改分类」→ 再「结构上不可能」→ 再「超出上限」→
 * 最后「撞到已有路径」）：
 *   1. `invalid`  路径本身不干净（空、空层级、单级超长）——后面所有判据都要读段，
 *                 坏输入先出局；
 *   2. `self`     拖到自己头上；
 *   3. `same`     拖回原位。**这不是错误**，面板据此不弹提示、不发意图；
 *   4. `descendant` 目标在自己的子树里 —— 把父挂到自己孩子下面会造出一个环，
 *                 改名之后 `a/b` 里还套着 `a`，树再也折不出来；
 *   5. `invalid`  整串超 64 字（子树一起搬，任何一条超限都算）；
 *   6. `too-deep` 层级上限 4。**要算子树**：`学习/考公` 下面还挂着 `行测` 时，
 *                 只按「目标深度 + 1」判会放过「搬过去之后第 5 级」的情况；
 *   7. `exists`   目标路径已存在（大小写不敏感，与写入侧去重同口径）。
 *                 刻意**不静默合并**两个标签：合并等于替用户做了一次看不见的数据决定，
 *                 而且它不可撤销（两个标签的事项从此混在一条路径上）。
 */
import { TAG_LIMITS } from "./normalize.ts";
import { isTagSameOrChild, parentTagPath, tagLeafName } from "./tagTree.ts";

export type ReparentReason =
  | "same"
  | "self"
  | "descendant"
  | "too-deep"
  | "exists"
  | "invalid";

export type ReparentOutcome =
  | { ok: true; next: string }
  | { ok: false; reason: ReparentReason };

/** 与写入侧（`normalizeTagPaths`）同一套去重口径：小写 + 词尾 sigma 归并。 */
function foldCase(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\u03c2/gu, "\u03c3");
}

/** 按**码点**数长度：`[...value].length`，与写入侧 `[...part].length` 口径一致。 */
function chars(value: string): number {
  return [...value].length;
}

function segmentsOf(path: string): string[] {
  return path.split("/");
}

/**
 * 干净路径：每级非空、无首尾空格、单级不超上限。
 * 与 `normalizeTagPath` 同口径 —— 但这里**不做归一化**：拖动的两端都来自已经存在
 * 的路径，出现不干净的值说明数据源本身坏了，不该在一次拖动里悄悄"修好"它。
 */
function isCleanPath(path: string): boolean {
  if (!path.trim()) return false;
  return segmentsOf(path).every((segment) => {
    const trimmed = segment.trim();
    return (
      trimmed.length > 0 &&
      trimmed === segment &&
      chars(segment) <= TAG_LIMITS.maxSegmentLength
    );
  });
}

/**
 * 子树里最深的一条比 `source` 深几层（`source` 自身算 0）。
 *
 * 这是 `too-deep` 判据的关键：`学习/考公` 搬到 `工作/技能/英语` 下面时，光看
 * 「目标 3 级 + 自己 1 级 = 4 级」是刚好合标的；但它下面还挂着 `行测` 的话，
 * `行测` 会变成第 5 级 —— 后端会把那一条跳过，用户看到的是"只搬了一半"。
 */
function subtreeRelativeDepth(source: string, existing: readonly string[]): number {
  const base = segmentsOf(source).length;
  let deepest = 0;
  for (const candidate of existing) {
    const path = candidate.trim();
    if (!path || !isTagSameOrChild(path, source)) continue;
    deepest = Math.max(deepest, segmentsOf(path).length - base);
  }
  return Math.max(0, deepest);
}

/**
 * 整棵子树搬过去之后，最长的那条路径有多少字。
 * 超过总长上限就该在发意图之前挡住（见文件头「后端会跳过超限的那一条」）。
 */
function longestMovedPath(
  source: string,
  parent: string | null,
  existing: readonly string[],
): number {
  const leaf = tagLeafName(source);
  let longest = parent === null ? chars(leaf) : chars(`${parent}/${leaf}`);
  for (const candidate of existing) {
    const path = candidate.trim();
    if (!path || foldCase(path) === foldCase(source)) continue;
    if (!isTagSameOrChild(path, source)) continue;
    /* `path` 以 `source` 开头，剩下的部分以 `/` 起头；搬过去只换前缀，尾巴不动 */
    const tail = path.slice(source.length).replace(/^\//, "");
    const moved = parent === null ? tail : `${parent}/${tail}`;
    longest = Math.max(longest, chars(moved));
  }
  return longest;
}

/**
 * 把 `from` 这棵子树挂到 `targetParent`（null = 一级）下面，返回新路径或拒绝理由。
 *
 * 只回答「可不可以、变成什么」，不落库：真正动手复用既有的 `state.rename`
 * （后端 `rename_tag` 一个事务带整棵子树）。
 */
export function reparentTagPath(
  from: string,
  targetParent: string | null,
  existing: readonly string[],
): ReparentOutcome {
  const source = from.trim();
  const parent = targetParent === null ? null : targetParent.trim();

  /* 1. 路径本身要干净：空、空层级（`a//b`）、单级超 32 字都算无效 */
  if (!isCleanPath(source)) return { ok: false, reason: "invalid" };
  if (parent !== null && !isCleanPath(parent)) return { ok: false, reason: "invalid" };

  /* 2. 拖到自己头上 */
  if (parent !== null && foldCase(parent) === foldCase(source)) {
    return { ok: false, reason: "self" };
  }

  /* 3. 拖回原位：静默（面板据此不弹提示、不发意图） */
  const currentParent = parentTagPath(source);
  if (foldCase(parent ?? "") === foldCase(currentParent ?? "")) {
    return { ok: false, reason: "same" };
  }

  /* 4. 目标在自己的子树里：改名之后会绕成环 */
  if (parent !== null && isTagSameOrChild(parent, source)) {
    return { ok: false, reason: "descendant" };
  }

  /* 5. 整串长度：子树一起搬，最长的那条超 64 字就拒绝 */
  if (longestMovedPath(source, parent, existing) > TAG_LIMITS.maxPathLength) {
    return { ok: false, reason: "invalid" };
  }

  /* 6. 层级：目标深度 + 自己 1 级 + 子树还有几层 */
  const targetDepth = parent === null ? 0 : segmentsOf(parent).length;
  if (targetDepth + 1 + subtreeRelativeDepth(source, existing) > TAG_LIMITS.maxDepth) {
    return { ok: false, reason: "too-deep" };
  }

  const next = parent === null ? tagLeafName(source) : `${parent}/${tagLeafName(source)}`;

  /* 7. 撞到已有路径：拒绝而不是合并（合并是一次看不见的数据决定，且不可撤销） */
  const key = foldCase(next);
  if (existing.some((candidate) => foldCase(candidate) === key)) {
    return { ok: false, reason: "exists" };
  }

  return { ok: true, next };
}

/**
 * 只算「会变成什么」，不做任何判据 —— 给面板把拒绝理由说成一句人话用
 * （例如 `「工作/考公」已经存在了`，没有 next 就写不出这句）。
 */
export function previewReparentPath(from: string, targetParent: string | null): string {
  const leaf = tagLeafName(from.trim());
  const parent = targetParent === null ? "" : targetParent.trim();
  return parent ? `${parent}/${leaf}` : leaf;
}
