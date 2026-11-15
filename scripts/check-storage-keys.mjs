#!/usr/bin/env node
/**
 * Timing — 存储键改名判据（T04-4 §7）：`patina:` / `patina.` 只住注册表
 * -----------------------------------------------------------------------------
 * T04-4 把分析窗的 24 个 localStorage 键从 `patina:` 前缀改到 `activity:`（唯一例外
 * `patina.icon-theme-colors.v2` 的点号族），迁移是"先写新、永不删老"的复制。这套
 * 判据防的是**改名之后又漂回去**：谁往哪个 store 里再写一个 `patina:` 字面量，
 * 那个键就永远逃出注册表的账本——迁移、跨窗事件过滤、判据 2 的双向一致全部对不上账。
 *
 * ## 五条判据
 *
 *   1 `patina:` / `patina.` 的**源码字面量**只允许出现在注册表的**声明行**
 *     （`legacy: 'patina…'` 字段 + 动态模板的前缀字面量）。
 *     注释一律剥掉——判据判的是字面量，不是"存储键"这个语义；而且不剥注释的话
 *     本文件自己的注释就先红了。
 *   2 注册表 ↔ 代码**双向一致**：注册表每个槽要么被出口调用按名引用、要么被动态
 *     模板前缀覆盖；出口调用（`readActivityKey("x")` 等）引用的每个名字必须真实
 *     存在于注册表。删一行 ⇒ 按名引用悬空 ⇒ 红；加一行没人的槽 ⇒ 红。
 *   3 **防空转**：槽数 < 15 ⇒ 红；扫到的 `patina` 字面量总数为 0 ⇒ 红；
 *     扫描面目录不存在或为空 ⇒ 红。三条合起来保证"正则失配 = 红"而不是
 *     "正则失配 = 安静地全绿"。
 *   4 **迁移只复制**：`migrateActivityStorage.ts` 里不得出现 `removeItem`。
 *   5 **零循环（结构判据）**：`migrateActivityStorage.ts` 里不得出现
 *     `activityStorageKeys`——静态 import、动态 `import()`、`require` 三种形式
 *     都是同一个子串，一个 grep 判死，没有腐烂空间。判的是它**不可能回调出口**。
 *
 * ## 已知的非存储键 `patina.` 字面量（扫描器显式排除）
 *
 *   · `patina.open` —— `timing.handles.v1` 的**动作 id 值**，不是存储键；它的改名
 *     兼容走 `handleBindings` 的读时归一化（M-8 守卫），与键改名是两条线。
 *
 * 实测（T04-4 之前）：`src/` 下 `patina:` 字面量 29 个，其中 6 个是
 * `performance.mark` 名（`patina:data-navigation:*`）——它们也要改前缀、但不迁移；
 * 改完之后它们进不了本判据的任何白名单，恰好把"改前缀是必须的"钉成机械事实。
 *
 * **判据 3 为什么必须存在**：本判据是 grep 型，正则写错（比如 `patina\.` 被转义
 * 吃掉）的症状是"扫到 0 个违规、全绿"——与"真的全干净"无法区分。槽数下限 +
 * 字面量总数下限 + 目录存在性把"失配"从静默变成红。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const KEYS_FILE = join(SRC, 'windows', 'shared', 'activityStorageKeys.ts');
const MIGRATE_FILE = join(SRC, 'windows', 'shared', 'migrateActivityStorage.ts');

/** 扫描面：`src/` 全部 .ts/.tsx，测试文件除外（测试里的 `patina:` 是假槽/种子，非账本）。 */
const SCOPE_DIRS = ['src'];
const TEST_FILE = /[.](test|spec)[.](ts|tsx)$/;
const EXT = /[.](ts|tsx)$/;

/** 剥行注释与块注释。字符串里的 `//`（如 URL）会被误剥——本判据只找 `patina`，误剥不产生假红。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1);
}

/** 收集扫描面里全部非测试源文件。 */
function collectFiles() {
  /** @type {string[]} */
  const files = [];
  for (const dir of SCOPE_DIRS) {
    const abs = join(root, dir);
    if (!statSync(abs).isDirectory()) {
      console.error(`[storage-keys] 扫描面目录不存在：${dir}`);
      process.exit(1);
    }
    const walk = (current) => {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (EXT.test(entry) && !TEST_FILE.test(entry)) files.push(full);
      }
    };
    walk(abs);
    if (!files.some((f) => f.startsWith(abs))) {
      console.error(`[storage-keys] 扫描面目录 ${dir} 下没有源文件（正则/路径失配？）`);
      process.exit(1);
    }
  }
  return files;
}

/**
 * `patina:` / `patina.` 字面量（排除 `patina.open` 动作 id）。
 * 判的是**字面量**，不是"存储键"语义——见文件头。
 */
const PATINA_LITERAL = /patina[:.](?!open\b)/g;

function countPatinaLiterals(text) {
  return [...text.matchAll(PATINA_LITERAL)].length;
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`[storage-keys] ✗ ${msg}`);
};
const ok = (msg) => console.log(`[storage-keys] ✓ ${msg}`);

const files = collectFiles();
const readRel = (p) => relative(root, p).replaceAll('\\', '/');
const strip = (p) => stripComments(readFileSync(p, 'utf8'));

/* ── 判据 1 ─────────────────────────────────────────────────────────────
 * 声明行 = 槽声明（`xxx: slot('name', 'patina…', …)`，legacy 是 slot() 的第二个
 * 位置参数）或动态模板行的 `legacy: 'patina…'` 字段。窄到"只在声明行"，
 * 不宽成"前缀任意出现"。 */
const keysStripped = strip(KEYS_FILE);
const DECLARATION_LINE = /(?:\w+:\s*slot\(\s*['"][^'"]+['"],\s*['"]patina)|(?:legacy\s*:\s*['"]patina)/;
const registryFile = readRel(KEYS_FILE);
const outsideDeclarations = [];
let keyFileTotal = 0;
for (const [index, line] of keysStripped.split('\n').entries()) {
  const hits = countPatinaLiterals(line);
  if (hits === 0) continue;
  keyFileTotal += hits;
  if (!DECLARATION_LINE.test(line)) {
    outsideDeclarations.push(`${registryFile}:${index + 1}`);
  }
}
if (outsideDeclarations.length > 0) {
  fail(`判据 1：注册表内 ${outsideDeclarations.length} 行的 patina 字面量不在声明行：\n      ${outsideDeclarations.join('\n      ')}`);
} else {
  ok(`判据 1：注册表内 patina 字面量 ${keyFileTotal} 处全部在声明行`);
}

const foreign = [];
let scannedTotal = 0;
for (const file of files) {
  if (file === KEYS_FILE) continue;
  const hits = countPatinaLiterals(strip(file));
  scannedTotal += hits;
  if (hits > 0) foreign.push(`${readRel(file)} ×${hits}`);
}
if (foreign.length > 0) {
  fail(`判据 1：注册表外 ${foreign.length} 个文件仍有 patina 存储键字面量：\n      ${foreign.join('\n      ')}`);
} else {
  ok(`判据 1：注册表外 patina 字面量 0 处（扫描 ${files.length - 1} 个文件）`);
}

/* ── 判据 2 ─────────────────────────────────────────────────────────────
 * 注册表解析：`xxx: slot('name', 'legacy'[, 'target'])` + 动态模板行。 */
const recordSource = readFileSync(KEYS_FILE, 'utf8');
/** @type {Map<string, {name: string, legacy: string, target?: string}>} */
const registry = new Map();
for (const m of recordSource.matchAll(/\w+:\s*slot\(\s*'([^']+)',\s*'([^']+)'(?:,\s*'([^']+)')?/g)) {
  registry.set(m[1], { name: m[1], legacy: m[2], target: m[3] });
}
/** @type {{name: string, legacy: string}[]} */
const templates = [];
for (const m of recordSource.matchAll(/\{\s*name:\s*'([^']+)',\s*legacy:\s*'([^']+)',[^}]*dynamic:\s*true/g)) {
  templates.push({ name: m[1], legacy: m[2] });
}

/* 出口按名调用的收集（非测试源码、注册表文件除外）。 */
const EXIT_CALL = /(?:readActivityKey|writeActivityKey|removeActivityKey|activityKeyOf|activityLegacyKeyOf)\(\s*['"]([^'"]+)['"]/g;
/** @type {Set<string>} */
const referencedNames = new Set();
for (const file of files) {
  if (file === KEYS_FILE) continue;
  for (const m of strip(file).matchAll(EXIT_CALL)) referencedNames.add(m[1]);
}

const templateCovered = (slot) => templates.some((t) => slot.legacy.startsWith(t.legacy));

/* 正向：注册表每个槽要么被按名引用、要么被动态模板覆盖。 */
const orphanSlots = [...registry.values()].filter(
  (slot) => !referencedNames.has(slot.name) && !templateCovered(slot),
);
if (orphanSlots.length > 0) {
  fail(`判据 2：注册表 ${orphanSlots.length} 个槽既无人按名引用、也不被动态模板覆盖：\n      ${orphanSlots.map((s) => s.name).join(', ')}`);
} else {
  const covered = [...registry.values()].filter((slot) => templateCovered(slot)).map((s) => s.name);
  ok(`判据 2 正向：注册表 ${registry.size} 槽全部有主（按名引用 ${registry.size - covered.length} + 模板覆盖 ${covered.length}${covered.length ? `：${covered.join(', ')}` : ''}）`);
}

/* 反向：出口引用的每个名字必须存在于注册表（删一行 ⇒ 引用悬空 ⇒ 红）。 */
const danglingRefs = [...referencedNames].filter((name) => !registry.has(name));
if (danglingRefs.length > 0) {
  fail(`判据 2 反向：出口引用了注册表不存在的槽名：${danglingRefs.join(', ')}`);
} else {
  ok(`判据 2 反向：出口按名引用 ${referencedNames.size} 个槽名全部在册`);
}

/* ── 判据 3 ─────────────────────────────────────────────────────────────
 * 防空转：槽数下限 / 字面量总数下限。0 是本判据的**事故值**，不是目标值。 */
if (registry.size < 15) {
  fail(`判据 3：注册表槽数 ${registry.size} < 15（解析正则失配或槽被批量删除）`);
} else {
  ok(`判据 3：注册表槽数 ${registry.size} ≥ 15`);
}
if (scannedTotal + keyFileTotal === 0) {
  fail('判据 3：扫到的 patina 字面量总数为 0（注册表一个 legacy 都没有——正则或账本失配）');
} else {
  ok(`判据 3：patina 字面量总数 ${scannedTotal + keyFileTotal} > 0（注册表内 ${keyFileTotal} + 注册表外应红 ${scannedTotal}）`);
}

/* ── 判据 4 / 5 ── 同样在剥注释后的源码上判：文件头与行内注释**必须**写明
 * 这两条禁令（否则下一个人会当误报），注释里出现禁词不是违例，代码里出现才是。 */
const migrateStripped = strip(MIGRATE_FILE);
if (migrateStripped.includes('removeItem')) {
  fail('判据 4：migrateActivityStorage.ts 代码出现 removeItem（迁移只复制，永不删老——INV-1）');
} else {
  ok('判据 4：迁移模块代码 removeItem 0 处（只复制）');
}

/* ── 判据 5 ─────────────────────────────────────────────────────────────
 * 一个 grep 判死：静态 import / 动态 import() / require 三种形式都含这个子串。
 * 判的是"不可能回调出口"（结构），不是"没调那几个函数"（行为）。 */
if (migrateStripped.includes('activityStorageKeys')) {
  fail('判据 5：migrateActivityStorage.ts 代码出现 activityStorageKeys（零循环：迁移不得依赖注册表——注册表作为参数传入）');
} else {
  ok('判据 5：迁移模块代码 activityStorageKeys 0 处（零循环，结构判据）');
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */
console.log(`[storage-keys] 扫描面：${SCOPE_DIRS.join(', ')}（非测试源文件 ${files.length} 个）`);
if (failures > 0) {
  console.error(`[storage-keys] FAIL — ${failures} 条判据红`);
  process.exit(1);
}
console.log('[storage-keys] OK — 五条判据全部通过');
