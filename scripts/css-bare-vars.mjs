#!/usr/bin/env node
/**
 * Timing — 分析窗样式里"裸变量"的盘子（口径脚本，只测量、不改代码）
 * -----------------------------------------------------------------------------
 * 为什么要有这个脚本：设置页在分析窗里有一类**静默失效**的声明 —— `var(--line)` 这类
 * 宿主遗留令牌只由 `.settings-host-sync` 那个桥提供（分析窗一条 `timing/styles/tokens/*`
 * 都不引），规则一旦不在桥作用域内，该声明在 computed-value 阶段直接失效取初始值
 * （`border→none` / `border-radius→0` / `background→transparent` / `padding→0`），
 * 页面不会报错，只会"看起来材质和别处不一样"。B5c / B5f / B5g 三次事故都是这个。
 *
 * 这个脚本只回答一个问题：**哪些 `var()` 没写 fallback，分别在哪**。
 * 它不判断"有没有源"、也不判断"规则在不在桥内"——那两个问题每次都要重新定口径，
 * 写进脚本只会把一时的结论固化成假绿。
 *
 * ## 口径（三个人对不上数时，先对齐这四条）
 *   1. **范围**：`src/windows/activity/shell/styles/**\/*.css` **目录全扫**（不是 `@import`
 *      闭包；后者 66 个文件，目录全扫 15 个 CSS 里有样式被闭包排除的差异会让人对不上账）。
 *   2. **去注释**：先剥 `/* … *\/`，否则注释里举例写的 `var(--line)` 会被算进去。
 *   3. **判定**：`var(` 之后取变量名，**名字后第一个非空字符不是 `,`** 即算"没 fallback"。
 *      （比"右括号紧跟"更严：能覆盖 `var(--x , 8px)` 这种中间带空格的写法。）
 *   4. **排除**：`--at-*` 与 `--font-*`。前者由 `useAppThemeMode` 在运行时注入 `:root`，
 *      后者在分析窗 `tokens.css` 的 `@theme` 里有定义。**注意排除 ≠ 一定存在**：
 *      `--at-*` 里也有全仓找不到定义点的（本脚本第二段会把它们单独列出来，别让前缀白名单
 *      吃掉真正的缺口）。
 *
 * ## 用法
 *   node scripts/css-bare-vars.mjs            # 主表（370）
 *   node scripts/css-bare-vars.mjs --list     # 逐条列出（文件 / 选择器 / 变量）
 *
 * 最后一行固定输出 `TOTAL <n>`，方便别处 grep 对账。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_DIR = resolve(ROOT, 'src/windows/activity/shell/styles');
const EXCLUDED_PREFIX = /^--(at-|font-)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith('.css')) out.push(abs);
  }
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 逐条 `var()`：变量名 + 有没有 fallback（名字后第一个非空字符是 `,`） */
function varsIn(text) {
  const found = [];
  let at = 0;
  while ((at = text.indexOf('var(', at)) !== -1) {
    let cursor = at + 4;
    let name = '';
    while (cursor < text.length && !/[,)]/.test(text[cursor])) {
      name += text[cursor];
      cursor += 1;
    }
    found.push({ name: name.trim(), hasFallback: text[cursor] === ',' });
    at += 4;
  }
  return found;
}

const rows = [];
for (const file of walk(STYLE_DIR).sort()) {
  const css = stripComments(readFileSync(file, 'utf8'));
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(css)) !== null) {
    const selector = rule[1].trim().replace(/\s+/g, ' ');
    if (!rule[2].includes('var(')) continue;
    for (const decl of rule[2].split(';')) {
      for (const v of varsIn(decl)) {
        if (v.hasFallback || !v.name.startsWith('--')) continue;
        rows.push({
          file: relative(ROOT, file).replace(/\\/g, '/'),
          selector,
          name: v.name,
          excluded: EXCLUDED_PREFIX.test(v.name),
        });
      }
    }
  }
}

const counted = rows.filter((row) => !row.excluded);
const excluded = rows.filter((row) => row.excluded);

const byFile = new Map();
for (const row of counted) {
  if (!byFile.has(row.file)) byFile.set(row.file, []);
  byFile.get(row.file).push(row);
}

console.log(`[css-bare-vars] 范围 ${relative(ROOT, STYLE_DIR)}（目录全扫）｜去注释｜"名字后第一个非空字符不是 ,"`);
const excludedFont = excluded.filter((row) => row.name.startsWith('--font-'));
const excludedAt = excluded.filter((row) => row.name.startsWith('--at-'));
console.log(`[css-bare-vars] 排除 --at-* / --font-*｜被排除的裸用：--font-* ${excludedFont.length} 处 + --at-* ${excludedAt.length} 处（仅备查，不计入 TOTAL）\n`);
for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const names = [...new Set(list.map((row) => row.name))].sort();
  console.log(`${String(list.length).padStart(3)}  ${file}  (${names.length} 个变量)`);
  if (process.argv.includes('--list')) {
    for (const row of list) console.log(`       ${row.selector}  ← ${row.name}`);
  }
}
console.log('');
if (process.argv.includes('--list')) {
  console.log('被排除的裸用（--at-* / --font-*，不计入 TOTAL）：');
  for (const row of excluded) console.log(`  ${row.file} :: ${row.selector} ← ${row.name}`);
  console.log('');
}
console.log(`TOTAL ${counted.length}  (${byFile.size} 个文件)`);

/* ---------------------------------------------------------------------------
 * 第二段：`--at-*` 里**没有定义点**的。
 * 上面把它们按前缀排除了，但"前缀是 --at-"并不等于"恒有定义"——
 * `--at-active-nav-index` 就是 `--at-*` 而没有定义点。前缀白名单会把它吃掉，
 * 所以这里单独量一次：定义点 = CSS 里的 `--x:` 或 TS/TSX 里作为自定义属性写的 `"--x":`。
 * 只报数，不判断该不该修。
 * ------------------------------------------------------------------------- */
function collect(dir, ext, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collect(abs, ext, out);
    } else if (ext.some((each) => entry.name.endsWith(each))) {
      out.push(abs);
    }
  }
  return out;
}

const definedAt = new Set();
for (const file of collect(resolve(ROOT, 'src'), ['.css'])) {
  for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
    definedAt.add(m[1]);
  }
}
for (const file of collect(resolve(ROOT, 'src'), ['.tsx', '.ts'])) {
  for (const m of readFileSync(file, 'utf8').matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) {
    definedAt.add(m[1]);
  }
}

const orphanAt = new Map();
for (const row of excludedAt) {
  if (definedAt.has(row.name)) continue;
  if (!orphanAt.has(row.name)) orphanAt.set(row.name, new Set());
  orphanAt.get(row.name).add(`${row.file} :: ${row.selector}`);
}
console.log('');
console.log(`[css-bare-vars] --at-* 里全仓找不到定义点的：${orphanAt.size} 个变量 / ${[...orphanAt.values()].reduce((sum, set) => sum + set.size, 0)} 条规则`);
for (const [name, rules] of [...orphanAt.entries()].sort()) {
  console.log(`  ${name}  ← ${[...rules].join(' | ')}`);
}
if (orphanAt.size === 0) console.log('  （无：每个 --at-* 都有定义点）');
