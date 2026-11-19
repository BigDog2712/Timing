export const TAG_LIMITS = { maxPathLength: 64, maxDepth: 4, maxSegmentLength: 32, maxPerObject: 12 } as const;

export type TagPathError = 'empty' | 'control' | 'segment' | 'depth' | 'path' | 'count';

export class TagPathValidationError extends Error {
  readonly reason: TagPathError;

  constructor(reason: TagPathError, message: string) {
    super(message);
    this.name = 'TagPathValidationError';
    this.reason = reason;
  }
}

export function normalizeTagPath(raw: string): string {
  const source = String(raw).trim().replace(/^#+/, '').replace(/\\/g, '/');
  if (/\p{Cc}/u.test(source)) {
    throw new TagPathValidationError('control', '标签不能包含控制字符');
  }
  const segments = source.split('/').map((part) => part.trim()).filter(Boolean);
  if (segments.some((part) => part.includes('#'))) {
    throw new TagPathValidationError('segment', '标签中的 # 只能出现在开头');
  }
  if (segments.some((part) => [...part].length > TAG_LIMITS.maxSegmentLength)) {
    throw new TagPathValidationError('segment', '标签单级长度不能超过 32 个字符');
  }
  if (segments.length > TAG_LIMITS.maxDepth) {
    throw new TagPathValidationError('depth', '标签最多支持 4 级路径');
  }
  const path = segments.join('/');
  if ([...path].length > TAG_LIMITS.maxPathLength) {
    throw new TagPathValidationError('path', '标签路径长度不能超过 64 个字符');
  }
  return path;
}

export function normalizeTagPaths(values: string[], maximum = 32): string[] {
  if (values.length > maximum) {
    throw new TagPathValidationError('count', `最多只能设置 ${maximum} 个标签`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const path = normalizeTagPath(value);
    /* 与 Rust `normalize_tag_paths` 对齐：空路径（`""` / `"#"` / `" / "`）直接跳过，
       不写进结果。漏了这一步，前端会把一条空标签发给后端 / 存进草稿，
       表现为「保存后多出一个看不见的 #」。 */
    if (path === '') continue;
    // Match Rust's context-free Unicode lowercase behavior for final sigma.
    const key = path.toLocaleLowerCase('en-US').replace(/\u03c2/gu, '\u03c3');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path);
    }
  }
  return result;
}
