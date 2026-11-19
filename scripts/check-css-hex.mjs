#!/usr/bin/env node
/**
 * Timing — 组件 CSS 禁裸 hex（B2 · P1 §2.4）
 * -----------------------------------------------------------------------------
 * ## 规约
 *
 * 裸 hex 色值（`#rgb` / `#rrggbb` / `#rrggbbaa`）**只允许**出现在「颜色真源层」：
 *   · 主窗 primitives / theme / aliases：tokens/01-primitives / 02-theme-dark /
 *     03-theme-light / 04-aliases，以及 design-tokens-compat（ThemePicker 预览真色）
 *   · 分析窗颜色真源：activity/shell/styles/tokens.css
 * 其余所有组件 CSS 一律引用 `var(--*)`，不得写裸 hex（P1 §2.4：primitives 之外禁裸 hex）。
 *
 * 本批只收口 **hex**（批次名「去裸 hex」）。rgb()/rgba()/hsl() 不在本门禁范围：
 * 组件里残留的 rgba 多为 `var(--line, rgba(...))` 的防御性回退，且 P0 对 box-shadow
 * 的 rgba 另有例外——那是独立议题，不混进本批。
 *
 * ## 为什么剥注释
 *
 * 多处组件 CSS 的**注释**里写了 hex（讲清某色的来历，如 dot.css / theme-picker.css）。
 * 判的是**字面量色值**，不是「注释里提到 hex」。不剥注释的话这些文件先假红。
 * 字符串里的 `#` 极罕见（CSS 几乎不在 string 里放色值），误剥不会产生假红。
 *
 * ## 防空转（grep 型门禁的通病：正则失配 = 安静全绿）
 *
 *   · 扫描到的组件 CSS 文件数为 0 ⇒ 红（路径/后缀失配）
 *   · 允许名单里的文件在盘上不存在 ⇒ 红（真源文件被改名/移动而名单没跟上）
 *   · 允许名单文件里扫到的 hex 总数为 0 ⇒ 红（真源一个色都没有 = 正则失配）
 * 三条合起来保证「失配」从静默变红。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

/** 颜色真源层：唯一允许写裸 hex 的文件（相对仓根，正斜杠）。 */
const ALLOW = [
  'src/windows/timing/styles/tokens/01-primitives.css',
  'src/windows/timing/styles/tokens/02-theme-dark.css',
  'src/windows/timing/styles/tokens/03-theme-light.css',
  'src/windows/timing/styles/tokens/04-aliases.css',
  'src/windows/timing/styles/design-tokens-compat.css',
  'src/windows/activity/shell/styles/tokens.css',
];

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** 剥块注释（CSS 只有 /* *​/ 一种）。保留换行以便报准行号。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function collectCss(dir) {
  const out = [];
  const walk = (cur) => {
    for (const e of readdirSync(cur)) {
      const full = join(cur, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith('.css')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const rel = (p) => relative(root, p).replaceAll('\\', '/');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`[css-hex] ✗ ${m}`); };
const ok = (m) => console.log(`[css-hex] ✓ ${m}`);

/* 防空转 1：真源文件必须真实存在。 */
const missingAllow = ALLOW.filter((p) => !existsSync(join(root, p)));
if (missingAllow.length > 0) {
  fail(`允许名单内 ${missingAllow.length} 个颜色真源文件不存在（改名/移动而名单没跟上）：\n      ${missingAllow.join('\n      ')}`);
}

const files = collectCss(SRC);
if (files.length === 0) {
  fail('src/ 下没扫到任何 .css（路径/后缀失配）');
}

const allowSet = new Set(ALLOW);
let allowHexTotal = 0;
const violations = [];
let scannedComponent = 0;

for (const file of files) {
  const r = rel(file);
  const code = stripComments(readFileSync(file, 'utf8'));
  if (allowSet.has(r)) {
    allowHexTotal += (code.match(HEX) || []).length;
    continue;
  }
  scannedComponent += 1;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const hits = lines[i].match(HEX);
    if (hits) violations.push(`${r}:${i + 1}  ${hits.join(' ')}`);
  }
}

/* 防空转 2：真源层一个 hex 都没有 = 正则失配（0 是事故值，不是目标值）。 */
if (allowHexTotal === 0) {
  fail('颜色真源层扫到的 hex 总数为 0（HEX 正则失配或真源被清空）');
} else {
  ok(`颜色真源层 hex ${allowHexTotal} 处（允许名单 ${ALLOW.length} 文件）`);
}

if (violations.length > 0) {
  fail(`组件 CSS 出现裸 hex ${violations.length} 处（应改引用 var(--*)；无等价令牌则先加 primitives）：\n      ${violations.join('\n      ')}`);
} else {
  ok(`组件 CSS 裸 hex 0 处（扫描 ${scannedComponent} 个组件 CSS 文件）`);
}

if (failures > 0) {
  console.error(`[css-hex] FAIL — ${failures} 条判据红`);
  process.exit(1);
}
console.log(`[css-hex] OK — 组件 CSS 禁裸 hex（真源 ${ALLOW.length} 文件豁免，组件 ${scannedComponent} 文件干净）`);
