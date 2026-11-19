/**
 * Timing — 单文件行数测量：物理行 vs 有效行
 * -----------------------------------------------------------------------------
 * 「有效行」= 物理行去掉**整行注释**与**空行**之后剩下的行数。行尾注释不剥，
 * 因为那一行本来就有代码，剥不剥都不影响判定。
 *
 * 为什么必须词法扫描而不是正则：`//` 在字符串里（`"https://x"`）、`/*` 在
 * CSS 的 `content: "/*"` 里、`#` 在 Rust 的 `r#"..."#` 里都不是注释。正则剥错会
 * 把代码当注释扣掉，门禁于是「变绿」，但文件其实没变小 —— 假绿比超限更危险。
 *
 * 失败安全原则（比精确更重要）：
 *   1. 单引号/双引号字符串**遇到换行即终止**。真实语法里只有 Rust 的 `\` 续行和
 *      JS 模板字符串允许跨行；万一扫描器判错（比如把 JSX 文本里的撇号当字符串开头），
 *      影响也止于当前行，不会一路吞到文件结尾把整份代码判成字符串。
 *   2. 判不准时按「代码」处理。少剥只会让行数偏大（更严格），不会放行。
 *   3. **字符串里的内容算代码行**：一段 30 行的 `r#"INSERT ..."#` 是真实体积的一部分，
 *      按注释扣掉会让文件行数虚低。这一条曾经漏掉，被全仓交叉验证抓出来过。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LINE_COMMENT_EXT = new Set(['.rs', '.ts', '.tsx']);
const NESTED_BLOCK_EXT = new Set(['.rs']);
const TEMPLATE_EXT = new Set(['.ts', '.tsx']);
const MAX_RAW_HASHES = 8;

/** 字符字面量 `'x'` / `'\n'`；Rust 的 `'a` 是生命周期，不是字符串。 */
function startsCharLiteral(text, i) {
  return text[i + 2] === "'" || text[i + 1] === '\\';
}

/**
 * 判断 `"` 是否属于 Rust raw string，返回其 `#` 数量，不是则返回 null。
 * 覆盖 `r"..."`、`r#"..."#`、`br#"..."#`。
 */
function rawHashCount(text, quoteIndex) {
  let k = quoteIndex - 1;
  let hashes = 0;
  while (k >= 0 && text[k] === '#' && hashes <= MAX_RAW_HASHES) {
    hashes += 1;
    k -= 1;
  }
  if (k < 0 || hashes > MAX_RAW_HASHES) return null;
  const isRaw = text[k] === 'r';
  const isByteRaw = text[k] === 'r' && text[k - 1] === 'b';
  if (!isRaw && !isByteRaw) return null;
  const before = text[k - 1];
  if (isRaw && before !== undefined && /[A-Za-z0-9_]/.test(before) && before !== 'b') return null;
  return hashes;
}

/**
 * @param {string} text 文件全文
 * @param {string} ext 含点的小写扩展名
 * @returns {{ raw: number, effective: number }}
 */
export function measureSource(text, ext) {
  const allowLineComment = LINE_COMMENT_EXT.has(ext);
  const nestBlock = NESTED_BLOCK_EXT.has(ext);
  const allowTemplate = TEMPLATE_EXT.has(ext);

  let raw = 0;
  let effective = 0;
  let hasCode = false;
  let inLineComment = false;
  let blockDepth = 0;
  let quote = null;
  let rawHashes = -1;

  const endLine = (keepString = false) => {
    if (hasCode) effective += 1;
    hasCode = false;
    inLineComment = false;
    if (!keepString && quote !== null && !(allowTemplate && quote === '`')) quote = null;
  };

  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];

    if (ch === '\n') {
      raw += 1;
      endLine();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }

    if (blockDepth > 0) {
      if (ch === '/' && text[i + 1] === '*') {
        if (nestBlock) blockDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '*' && text[i + 1] === '/') {
        blockDepth -= 1;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inLineComment) {
      i += 1;
      continue;
    }

    if (rawHashes >= 0) {
      if (ch === '"') {
        let k = 0;
        while (k < rawHashes && text[i + 1 + k] === '#') k += 1;
        if (k === rawHashes) {
          i += 1 + rawHashes;
          rawHashes = -1;
          continue;
        }
      }
      // 字符串内容就是文件内容。多行 SQL / 模板文本必须计入，否则一段 30 行的
      // `r#"INSERT ..."#` 会整块被判成「空行」，文件行数虚低 —— 那是假绿。
      if (ch !== ' ' && ch !== '\t') hasCode = true;
      i += 1;
      continue;
    }

    if (quote !== null) {
      if (ch === '\\') {
        // Rust 的行续行：反斜杠后直接换行，字符串跨行继续，行数照算。
        if (text[i + 1] === '\n') {
          hasCode = true;
          raw += 1;
          endLine(true);
          i += 2;
          continue;
        }
        hasCode = true;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch !== ' ' && ch !== '\t') hasCode = true;
      i += 1;
      continue;
    }

    if (allowLineComment && ch === '/' && text[i + 1] === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      blockDepth = 1;
      i += 2;
      continue;
    }

    if (ch === '"') {
      const hashes = ext === '.rs' ? rawHashCount(text, i) : null;
      if (hashes !== null) {
        rawHashes = hashes;
        i += 1;
        continue;
      }
      quote = '"';
      hasCode = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      if (ext === '.rs' && !startsCharLiteral(text, i)) {
        hasCode = true;
        i += 1;
        continue;
      }
      quote = "'";
      hasCode = true;
      i += 1;
      continue;
    }
    if (ch === '`' && allowTemplate) {
      quote = '`';
      hasCode = true;
      i += 1;
      continue;
    }

    if (ch !== ' ' && ch !== '\t' && ch !== '\uFEFF') hasCode = true;
    i += 1;
  }

  // 末行没有以换行结束时不会被上面的分支结算
  if (n > 0 && !text.endsWith('\n')) {
    raw += 1;
  }
  endLine();

  return { raw, effective };
}

/** 兼容旧调用：只看物理行数。 */
export function physicalLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * CLI：量单个文件或 stdin 的有效行。
 *   node scripts/size-measure.mjs path/to/file.rs
 *   git show HEAD:path/to/file.rs | node scripts/size-measure.mjs --ext .rs
 * 用于「门禁跑在工作树上、提交后要核 blob」那一手 —— `wc -l` 量的是物理行。
 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const extFlag = args.indexOf('--ext');
  const explicitExt = extFlag >= 0 ? args[extFlag + 1] : null;
  const file = args.find((arg, index) => !arg.startsWith('--') && !(extFlag >= 0 && index === extFlag + 1));
  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  const ext = explicitExt ?? (file ? file.slice(file.lastIndexOf('.')).toLowerCase() : '.ts');
  const { effective, raw } = measureSource(text, ext);
  console.log(`${effective} 有效行 / ${raw} 物理行${file ? ` — ${file}` : ''}`);
}
