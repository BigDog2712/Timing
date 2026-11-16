#!/usr/bin/env node
/**
 * 一次性：去 Patina 化的目录 / 模块重命名（T02）。
 *
 * 为什么必须脚本化而不是手改：本批 1140 个文件、约 1500 处改写，其中**相对 import
 * 与「按仓库相对路径读源码」的字符串字面量 eslint 一条都管不到**——手改必然漏，
 * 而 `cargo check` 对前端完全无感、`tsc` 对 Rust 完全无感，漏一处只有门禁/测试能抓。
 *
 * ## 为什么必须有 `--reverse`
 *
 * T05 会执行数据库文件改名。**迁移一旦跑过就不能回滚**（用户的库已经叫新名字了）。
 * 那时若要退回代码态，只能「反向重命名 + `git revert`」。没有 `--reverse`，
 * 反向重命名就得再手写一遍——而手写的那份不会有人测。
 *
 * ## 绝对不碰的「落盘坐标」（改了就是运行时炸或用户数据找不到）
 *
 * 下面这些看起来像品牌残留，其实是磁盘 / 协议坐标，本脚本的规则**逐条绕开**它们：
 *
 * | # | 坐标 | 绕开方式 |
 * |---|---|---|
 * | 1 | `<数据根>/patina/` 目录名 | 规则只匹配带 `windows/` 前缀或 `src-tauri/src/<层>/` 前缀的路径，裸 `"patina"` 字符串不匹配 |
 * | 2 | `<数据根>/patina/data/patina.db` | 同上；`patina.db` 不含斜杠，任何规则都不命中 |
 * | 3 | `patina.html` 磁盘文件名 | 规则要的是 `patina/`（带斜杠）或 `src/windows/patina/`；`patina.html` 尾字符是 `.`，不匹配 |
 * | 4 | `%APPDATA%\Patina`（另一个独立产品） | 大写 `Patina` 且不带斜杠路径，规则大小写敏感、不命中 |
 * | 5 | 根指针 JSON 的 `dataDir` key | 本脚本不碰 `infra/root_pointer.rs` 的任何结构 |
 * | 6 | 库文件名的 `format!("{}")` | 该处传的是库名常量，不含 `patina/` 路径段 |
 * | 7 | `install_id.txt` / `.patina-import-done` | 前者是纯文本 id；后者是 `.patina-import-done`，`patina` 后接 `-`，不匹配 `patina/` |
 *
 * 另外**不在本批**（各有归属批次）：`qp-` CSS 前缀（T03）、窗口 label / 权限标识符 /
 * 事件名（T04）、DB / localStorage / 标记文件（T05）、`patina_coverage` 等 Cargo feature 名。
 *
 * 用法：
 *   node scripts/oneoff/rename-debrand.mjs --dry-run   # 只报数，不动文件
 *   node scripts/oneoff/rename-debrand.mjs             # 正向执行
 *   node scripts/oneoff/rename-debrand.mjs --reverse   # 反向（回到 T02 之前）
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const REVERSE = process.argv.includes('--reverse');
const DRY = process.argv.includes('--dry-run');

/* ─────────────────────────── 目录与文件搬迁 ─────────────────────────── */

/** 后端五层各自的 `insight` 子树。 */
const BE_LAYERS = ['app', 'commands', 'infra', 'models', 'services'];

/** 正向的「旧 → 新」。`--reverse` 时整表对调。 */
const FORWARD_MOVES = [
  /* 前端分析窗：753 个文件。 */
  ['src/windows/patina', 'src/windows/activity'],
  ...BE_LAYERS.map((layer) => [`src-tauri/src/${layer}/insight`, `src-tauri/src/${layer}/activity`]),
  /* 宿主侧接线：`patina_bridge` 管落点 + 读侧，`patina_seed` 是一次性导入（本批并改名）。 */
  ['src-tauri/src/app/patina_bridge.rs', 'src-tauri/src/app/activity_bridge.rs'],
  ['src-tauri/src/app/patina_seed.rs', 'src-tauri/src/app/legacy_import.rs'],
];

const MOVES = FORWARD_MOVES.map(([from, to]) => (REVERSE ? [to, from] : [from, to]));

/* ─────────────────────────── 内容改写规则 ─────────────────────────── */

/**
 * 文件内容改写。**顺序有意义**：
 * 先 `src/windows/patina/` 再 `windows/patina/`——否则前者的产物会被后者二次命中。
 *
 * 每条规则都刻意**要求足够长的上下文**（模块路径 `insight::`、带层名前缀的
 * `src-tauri/src/<层>/`、带 `windows/` 前缀的路径、带 `../` 的相对说明符），
 * 为的是让「落盘坐标」在构造上就不可能被命中，而不是靠事后逐条检查。
 */
const REWRITE_RULES = [
  /* ── Rust 模块路径 ─────────────────────────────────────────────── */
  // `crate::models::insight::events` → `...::activity::events`；`\b` 让 `insight_events` 不受影响
  { name: 'rust: insight:: → activity::', re: /\binsight::/g, to: 'activity::' },
  // `pub mod insight;` → `pub mod activity;`
  { name: 'rust: mod insight; → mod activity;', re: /\bmod insight;/g, to: 'mod activity;' },
  // `use crate::app::insight as app`（别名式 use，不带 `::`）
  { name: 'rust: ::insight as → ::activity as', re: /::insight as\b/g, to: '::activity as' },

  /* ── 带层名前缀的后端路径（注释与字符串字面量里的落点描述） ───────── */
  {
    name: 'rust path: <层>/insight/ → <层>/activity/',
    re: /(src-tauri\/src\/(?:app|commands|infra|models|services)\/)insight\//g,
    to: '$1activity/',
  },
  /* `include_str!("../app/insight/main_window.rs")` —— 相对宏路径。
     `cargo check` 实测就是它抓出来的：这种写法既不带 `src-tauri/src/` 前缀，
     也躲开了上面那条规则，**只有编不过才会暴露**（不是门禁、不是 tsc）。 */
  {
    name: 'rust macro path: ../<层>/insight/ → ../<层>/activity/',
    re: /((?:\.\.\/)+(?:app|commands|infra|models|services)\/)insight\//g,
    to: '$1activity/',
  },

  /* ── 宿主侧接线的标识符 ────────────────────────────────────────── */
  { name: 'ident: patina_bridge → activity_bridge', re: /\bpatina_bridge\b/g, to: 'activity_bridge' },
  { name: 'ident: patina_seed → legacy_import', re: /\bpatina_seed\b/g, to: 'legacy_import' },
  { name: 'ident: patina_root → activity_root', re: /\bpatina_root\b/g, to: 'activity_root' },
  /* 局部别名：`use crate::models::activity::events as insight_events;`。
   * `insight::` 那条规则抓不到它（`insight` 后面跟的是 `_` 不是 `::`），
   * 但它是代码里最后一处 `insight` 标识符——不改的话 grep 审计永远剩这一撮。 */
  { name: 'ident: insight_events → activity_events', re: /\binsight_events\b/g, to: 'activity_events' },

  /* ── 前端路径（顺序：最具体 → 最宽泛） ──────────────────────────── */
  // 仓库相对路径字符串（测试里 `read("src/windows/patina/...")` 靠它定位源文件）
  { name: 'fe path: src/windows/patina/ → activity/', re: /src\/windows\/patina\//g, to: 'src/windows/activity/' },
  // 不带 `src/` 前缀的写法（注释、check-layers 的 roots、allowlist 前缀）
  { name: 'fe path: windows/patina/ → activity/', re: /windows\/patina\//g, to: 'windows/activity/' },
  // 跨窗相对说明符：`../../patina/shell/styles/...` → `../../activity/...`
  {
    name: 'fe spec: ../patina/ → ../activity/',
    re: /(?:\.\.\/)+patina\//g,
    to: (match) => match.replace(/patina\/$/, 'activity/'),
  },
  /* 正则字面量里的**转义斜杠**写法：`/^src\/windows\/patina\//`。
   * 上面几条规则写的是裸 `/`，匹配不到 `\/`——实测就是它让 `toolsRetirement.source.test.ts`
   * 的 `read()` 前缀剥离静默失效（路径拼错 → 5 个用例 ENOENT 式失败，而 tsc / eslint 全绿）。 */
  {
    name: 'fe regex: src\\/windows\\/patina\\/ → activity',
    re: /src\\\/windows\\\/patina\\\//g,
    to: 'src\\/windows\\/activity\\/',
  },
];

/**
 * 反向规则：把正向的每一条对调，并把替换模板里的 `$1` 位置原样保留。
 * 纯字符串的 `to` 直接互换；函数式 `to` 单独写（否则反推会错）。
 */
function buildReverseRules() {
  return [
    // 函数式那条要单独反写：`activity/` 收尾换回 `patina/`
    {
      name: 'fe regex: src\\/windows\\/activity\\/ → patina',
      re: /src\\\/windows\\\/activity\\\//g,
      to: 'src\\/windows\\/patina\\/',
    },
    {
      name: 'fe spec: ../activity/ → ../patina/',
      re: /(?:\.\.\/)+activity\//g,
      to: (match) => match.replace(/activity\/$/, 'patina/'),
    },
    { name: 'fe path: windows/activity/ → patina/', re: /windows\/activity\//g, to: 'windows/patina/' },
    { name: 'fe path: src/windows/activity/ → patina/', re: /src\/windows\/activity\//g, to: 'src/windows/patina/' },
    { name: 'ident: activity_root → patina_root', re: /\bactivity_root\b/g, to: 'patina_root' },
    { name: 'ident: activity_events → insight_events', re: /\bactivity_events\b/g, to: 'insight_events' },
    { name: 'ident: legacy_import → patina_seed', re: /\blegacy_import\b/g, to: 'patina_seed' },
    { name: 'ident: activity_bridge → patina_bridge', re: /\bactivity_bridge\b/g, to: 'patina_bridge' },
    {
      name: 'rust macro path: ../<层>/activity/ → ../<层>/insight/',
      re: /((?:\.\.\/)+(?:app|commands|infra|models|services)\/)activity\//g,
      to: '$1insight/',
    },
    {
      name: 'rust path: <层>/activity/ → <层>/insight/',
      re: /(src-tauri\/src\/(?:app|commands|infra|models|services)\/)activity\//g,
      to: '$1insight/',
    },
    { name: 'rust: ::activity as → ::insight as', re: /::activity as\b/g, to: '::insight as' },
    { name: 'rust: mod activity; → mod insight;', re: /\bmod activity;/g, to: 'mod insight;' },
    { name: 'rust: activity:: → insight::', re: /\bactivity::/g, to: 'insight::' },
  ];
}

const RULES = REVERSE ? buildReverseRules() : REWRITE_RULES;

/* ─────────────────────────── 待改写的文件集合 ─────────────────────────── */

/**
 * 参与改写的文件。刻意用白名单式后缀 + 白名单式目录，**不遍历 docs/**：
 * 文档措辞是 T06 的事，本批碰了会让 diff 无法评审（也会撞上别人正在改的 README）。
 */
const TEXT_SUFFIXES = ['.rs', '.ts', '.tsx', '.css', '.mjs', '.js', '.json', '.toml', '.html', '.txt'];

/** 这些前缀下的文件不碰（各有归属批次，或本脚本自身）。 */
const SKIP_PREFIXES = [
  'docs/', // T06 文档收口
  'scripts/oneoff/', // 本脚本自身 + 其它历史一次性脚本
  'src-tauri/capabilities/', // 窗口 label / 权限标识符 → T04
  'src-tauri/permissions/', // 同上 → T04
  'src-tauri/gen/', // 生成的 Android 工程
  'node_modules/',
  'target/',
  'dist/',
];

/** 只在仓库根、且明确属于配置层的散装文件。 */
const ROOT_FILES = [
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'patina.html',
  'index.html',
];

/**
 * **豁免**：该文件刻意同时写出新旧两套名字（它按 treeish 解析路径，改名前后都要能跑）。
 * 通用规则会把它的「新名 → 旧名」映射表当成待改写的目标 → 恒等替换写成恒等函数，
 * 规范化静默失效。实测踩过：脚本跑完门禁全绿、测试全红。
 * 这是批量改名的反噬面——**反向映射表本身就是旧名的栖身处**。
 */
const EXEMPT_FILES = new Set([
  'src/windows/activity/shell/components/toolsRetirement.source.test.ts',
]);

function listTracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * 搬迁之后目录名已变，`git ls-files` 给的还是旧路径。所以先按「改写后应存在的路径」
 * 求集合：一边是已经搬好的新路径，一边是根配置。搬迁已在 `applyMoves()` 里完成，
 * 这里直接读当前磁盘状态。
 */
function targetFiles() {
  const all = listTracked();
  const picked = [];
  for (const rel of all) {
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (EXEMPT_FILES.has(rel)) continue;
    if (!TEXT_SUFFIXES.some((s) => rel.endsWith(s))) continue;
    const inSrc = rel.startsWith('src/') || rel.startsWith('src-tauri/src/') || rel.startsWith('scripts/');
    const inRoot = ROOT_FILES.includes(rel);
    if (!inSrc && !inRoot) continue;
    picked.push(rel);
  }
  return picked;
}

/* ─────────────────────────── 执行 ─────────────────────────── */

function applyMoves() {
  let moved = 0;
  for (const [from, to] of MOVES) {
    const absFrom = join(ROOT, from);
    const absTo = join(ROOT, to);
    if (!existsSync(absFrom)) {
      /* 反向时若曾分多次跑过，源可能已不在——报出来而不是静默跳过。 */
      console.log(`  · 跳过（源不存在）：${from}`);
      continue;
    }
    if (existsSync(absTo)) {
      throw new Error(`目标已存在，拒绝覆盖：${to}`);
    }
    if (DRY) {
      console.log(`  · 会搬迁：${from} → ${to}`);
    } else {
      execFileSync('git', ['mv', from, to], { cwd: ROOT, stdio: 'inherit' });
      console.log(`  · 已搬迁：${from} → ${to}`);
    }
    moved += 1;
  }
  return moved;
}

function rewriteAll() {
  const files = targetFiles();
  const perRule = new Map(RULES.map((r) => [r.name, 0]));
  let touchedFiles = 0;
  let totalEdits = 0;

  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const before = readFileSync(abs, 'utf8');
    let after = before;

    for (const rule of RULES) {
      /* 用 match 数统计「改写处数」，而不是 replace 的返回值——replace 不告诉命中几次。 */
      const hits = after.match(rule.re);
      if (!hits) continue;
      perRule.set(rule.name, perRule.get(rule.name) + hits.length);
      after = after.replace(rule.re, rule.to);
    }

    if (after !== before) {
      touchedFiles += 1;
      totalEdits += 1;
      if (!DRY) writeFileSync(abs, after, 'utf8');
    }
  }

  console.log('\n── 改写统计 ──');
  for (const [name, hits] of perRule) {
    if (hits > 0) console.log(`  ${String(hits).padStart(5)} 处  ${name}`);
  }
  return { files: touchedFiles, rules: [...perRule.values()].reduce((a, b) => a + b, 0) };
}

console.log(`\n=== rename-debrand（${DRY ? 'dry-run' : REVERSE ? 'REVERSE' : 'FORWARD'}）===`);
console.log('── 搬迁 ──');
const moved = applyMoves();
const stats = rewriteAll();

console.log('\n── 小结 ──');
console.log(`  目录/文件搬迁：${moved} 项`);
console.log(`  内容被改动的文件：${stats.files} 个`);
console.log(`  改写处数：${stats.rules} 处`);
console.log(DRY ? '\n（dry-run，未写盘）\n' : '');
