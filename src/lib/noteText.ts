/**
 * TickBar — 便利贴正文的纯文本编辑操作（[V0.2.2 · 2]）
 * -----------------------------------------------------------------------------
 * 与 React 无关的纯函数，输入 (文本, 选区) 输出 (新文本, 新选区)，便于单独验证：
 *   - `bulletizeOnSpace`：行首 `-` 后按空格 → 变成 `• `（markdown 列表的点）
 *   - `continueListOnEnter`：`• ` 行按 Enter → 续一个同样缩进的圆点；空圆点行则收尾
 *   - `indentSelection`：Tab / Shift+Tab → 对选区覆盖的每一行加 / 减一级（2 空格）
 */
export const INDENT = '  ';
export const BULLET = '• ';

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  value: string;
  start: number;
  end: number;
}

/** 位置 pos 所在行的行首下标 */
export function lineStart(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

/** 位置 pos 所在行的行尾下标（不含换行符） */
export function lineEnd(value: string, pos: number): number {
  const idx = value.indexOf('\n', pos);
  return idx === -1 ? value.length : idx;
}

/** 行首 `-` 后按空格：把破折号换成圆点；不满足条件返回 null（交给默认输入） */
export function bulletizeOnSpace(value: string, selection: Selection): EditResult | null {
  const { start, end } = selection;
  if (start !== end) return null;
  const head = value.slice(lineStart(value, start), start);
  if (!/^\s*-$/.test(head)) return null;
  const bulletStart = start - 1;
  const next = `${value.slice(0, bulletStart)}${BULLET}${value.slice(start)}`;
  const caret = bulletStart + BULLET.length;
  return { value: next, start: caret, end: caret };
}

/** `• ` 行按 Enter：续行带缩进与圆点；圆点后无内容则删掉这个空圆点 */
export function continueListOnEnter(value: string, selection: Selection): EditResult | null {
  const { start, end } = selection;
  if (start !== end) return null;
  const from = lineStart(value, start);
  const current = value.slice(from, start);
  const match = /^(\s*)•\s?/.exec(current);
  if (!match) return null;

  const indent = match[1];
  const rest = current.slice(match[0].length);
  if (rest.length > 0) {
    const caret = start + 1 + indent.length + BULLET.length;
    return { value: `${value.slice(0, start)}\n${indent}${BULLET}${value.slice(start)}`, start: caret, end: caret };
  }
  /* 空圆点行：Enter 收尾，圆点整段去掉，光标落在空行的行首 */
  return { value: `${value.slice(0, from)}\n${value.slice(start)}`, start: from + 1, end: from + 1 };
}

/** Tab / Shift+Tab：对选区覆盖的所有行加 / 减一级缩进 */
export function indentSelection(value: string, selection: Selection, outdent: boolean): EditResult {
  const { start, end } = selection;
  const from = lineStart(value, start);
  const to = lineEnd(value, end);

  let firstDelta = 0;
  const lines = value.slice(from, to).split('\n');
  const nextLines = lines.map((line, index) => {
    if (outdent) {
      const strip = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') ? 1 : 0;
      if (index === 0) firstDelta = -strip;
      return line.slice(strip);
    }
    if (index === 0) firstDelta = INDENT.length;
    return INDENT + line;
  });

  const nextBlock = nextLines.join('\n');
  const next = value.slice(0, from) + nextBlock + value.slice(to);
  const caret = Math.max(from, start + firstDelta);
  const caretEnd = Math.max(caret, end + (nextBlock.length - (to - from)));
  return { value: next, start: caret, end: caretEnd };
}
