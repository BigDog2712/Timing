#!/usr/bin/env node
/**
 * Timing — 组件 CSS 禁裸 hex 判据（B2 · P1 §2.4「裸 hex 治理」）
 * -----------------------------------------------------------------------------
 * ## 为什么需要它
 *
 * 项目硬约束「CSS 只用 var(--*) 令牌、零字面量色值」此前只是 token 文件头的**文字规约**，
 * 无机检。裸 hex 散进组件 CSS 的症状是**静默的**：改主题时那一处不跟着变、暗/浅切换时
 * 露出一块不属于当前主题的颜色，而没有任何判据报红——只有人肉逐屏看才可能发现。
 * 本判据把「组件 CSS 里又写了一个裸 hex」变成当场红。
 *
 * ## 判据
 *
 *   1 **组件 CSS 零裸 hex**：允许清单（primitives/theme 真源文件）之外的任何 .css，
 *     剥注释后不得出现 `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` 字面量。
 *     真源文件是**唯一允许写裸 hex 的地方**（P1 §2.1 三层令牌的第一层）。
 *   2 **防空转（扫描面非空）**：扫到的组件 CSS 文件数为 0 ⇒ 红（glob 失配/路径写错）。
 *   3 **防空转（真源确有 hex）**：允许清单里的 token 文件**合计** hex 数为 0 ⇒ 红
 *     （正则被转义吃掉的症状是「组件面全绿」，与真干净无法区分；真源恒有大量 hex，
 *      合计为 0 只可能是正则失配）。
 *   4 **允许清单每个文件都必须真实存在**：清单里写了一个不存在的路径 ⇒ 红
 *     （防重构挪动文件后清单静默豁免一个已不在原位的名字）。
 *
 * ## 为什么只判 hex，不判 rgb()/hsl()
 *
 * B2 的范围是「去裸 hex」（简报与 P1 §2.4 均以 hex 计数）。组件里尚存的 rgb()/hsl()
 * 分两类：① `var(--token, rgba(…))` 形式的**回退值**（token 缺失兜底，非主色）；
 * ② 取色控件（app-shell 的 HSV/色相轨）与设备色令牌（device-lanes）的**功能性**色值。
 * 两类都不是「本该走主题令牌却写死了的主色」，不在本批收口范围；扩大到 rgb/hsl 需单开
 * 一批逐个甄别回退值与功能色，混进来只会制造假红。本判据因此**精确对齐 hex**。
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 允许写裸 hex 的真源文件（P1 §2.1 第一层 primitives + 第二层 theme）。
 * 组件 CSS 一律不在此列。路径相对仓根，用 / 分隔。
 */
const ALLOWLIST = [
  // 主窗三层令牌真源
  'src/windows/timing/styles/tokens/01-primitives.css',
  'src/windows/timing/styles/tokens/02-theme-dark.css',
  'src/windows/timing/styles/tokens/03-theme-light.css',
  'src/windows/timing/styles/tokens/04-aliases.css',
  // 主题卡迷你预览「真实色」缩略（ThemePicker，非 UI 语义色，字面量集中于此）
  'src/windows/timing/styles/design-tokens-compat.css',
  // 分析窗令牌真源（@theme 映射 + 表面层次 + 派生色底 + 星标金）
  'src/windows/activity/shell/styles/tokens.css',
];

/** `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`。\b 收尾避免吃到 8 位后的字符。 */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/** 剥块注释（CSS 只有 /* *\/ 一种）。注释里的 hex（对比度说明等）不算违规。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const read = (rel) => readFileSync(join(root, rel), 'utf8');

/** 全部纳管的 CSS（git 跟踪的 src/**\/*.css）。 */
const allCss = execSync('git ls-files "src/**/*.css"', { cwd: root })
  .toString().trim().split('\n').filter(Boolean).map((p) => p.replaceAll('\\', '/'));

const allow = new Set(ALLOWLIST);
let failures = 0;
const fail = (msg) => { failures += 1; console.error(`[component-hex] ✗ ${msg}`); };
const ok = (msg) => console.log(`[component-hex] ✓ ${msg}`);

/* ── 判据 4：允许清单每个文件都要在盘上 ──────────────────────────────── */
const missing = ALLOWLIST.filter((rel) => !existsSync(join(root, rel)) || !allCss.includes(rel));
if (missing.length > 0) {
  fail(`判据 4：允许清单含 ${missing.length} 个不存在/未跟踪的文件（重构挪动后未同步清单？）：\n      ${missing.join('\n      ')}`);
} else {
  ok(`判据 4：允许清单 ${ALLOWLIST.length} 个真源文件全部存在`);
}

/* ── 判据 3：真源确有 hex（防正则失配静默全绿）────────────────────────── */
let allowHexTotal = 0;
for (const rel of ALLOWLIST) {
  if (!existsSync(join(root, rel))) continue;
  allowHexTotal += [...stripComments(read(rel)).matchAll(HEX)].length;
}
if (allowHexTotal === 0) {
  fail('判据 3：允许清单内真源文件合计 hex 数为 0（HEX 正则失配——组件面「全绿」不可信）');
} else {
  ok(`判据 3：允许清单内真源合计 ${allowHexTotal} 处裸 hex（> 0，正则确在命中）`);
}

/* ── 判据 1 + 2：组件 CSS 零裸 hex ───────────────────────────────────── */
const componentFiles = allCss.filter((rel) => !allow.has(rel));
if (componentFiles.length === 0) {
  fail('判据 2：扫到的组件 CSS 文件数为 0（glob 失配或路径写错）');
} else {
  ok(`判据 2：组件 CSS 扫描面 ${componentFiles.length} 个文件（纳管 ${allCss.length} − 真源 ${ALLOWLIST.length}）`);
}

const violations = [];
for (const rel of componentFiles) {
  const code = stripComments(read(rel));
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const hits = lines[i].match(HEX);
    if (hits) violations.push(`${rel}:${i + 1}  ${hits.join(' ')}`);
  }
}
if (violations.length > 0) {
  fail(`判据 1：组件 CSS 发现 ${violations.length} 处裸 hex（应收口到真源文件并以 var(--*) 引用）：\n      ${violations.join('\n      ')}`);
} else {
  ok('判据 1：组件 CSS 裸 hex 0 处');
}

if (failures > 0) {
  console.error(`[component-hex] FAIL — ${failures} 条判据红`);
  process.exit(1);
}
console.log('[component-hex] OK — 组件 CSS 禁裸 hex（四条判据全部通过）');
