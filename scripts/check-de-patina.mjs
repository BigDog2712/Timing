#!/usr/bin/env node
/**
 * Timing — de-Patina 门禁（T05：活动库与数据目录改名）
 * -----------------------------------------------------------------------------
 * 这一批改的是**已落盘坐标**：`patina/data/patina.db` → `activity/data/activity.db`。
 * 改错了不会报错，只会在用户那边表现为「历史突然空了、应用一切正常」——所以判据全部
 * 做成**结构断言**，而不是「看起来改完了」。
 *
 * 七条（前六条是约束，第七条防前六条空转）：
 *
 *   1. 旧目录名不再作为**路径片段**出现：`join("patina")` / `"patina/…"` / `"patina\\…"`
 *      在生产面计数 == 0，唯一例外是 `LEGACY_ACTIVITY_DATA_REL` 的声明行（旧名在仓里
 *      只能有一个住所）。**精确字符串字面量计数**，不是「含 patina 字样」——`patina_coverage`
 *      feature 名、`patina.storage-control.v1` 格式串、`patina: ...` 日志都不是路径。
 *   2. `*.db` 不得经 `fs::copy`（WAL 下主文件与 `-wal` 是两个时刻的快照，直拷拿到撕裂
 *      的页）。迁移模块里必须见到 `VACUUM INTO`，且 `fs::copy` 的调用点不得碰库；
 *      完整路径字面量 `"activity/data"` 只准出现在 `ACTIVITY_DATA_REL` 的声明行。
 *   3. 旧路径永不删：迁移模块 `remove_dir_all` == 0；`remove_file` 只准出现在名字含
 *      `partial` 的函数体内（那是删我们自己被 kill 时留下的半截副本）。
 *   4. 结构上不可能落「已完成」标记：迁移模块 `fs::write` == 0。T04-4 那个
 *      「finally 里无条件置 done」的形态因此写不出来。
 *   5. 不许按字样改写库内数据：`LIKE '%patina%'` / `REPLACE(` 含 patina 字样的 SQL 计数
 *      == 0（C-2 实测：需要改名的行 = 0，所以这种 SQL 只可能是画蛇添足且不可逆）。
 *   6. fail-open 且**两个开关都接上**：`activity_bridge.rs` 里必须同时出现 `data_layout`
 *      与 `webview_layout`，且不得出现 `.join(ACTIVITY_SUBDIR)` 或任何 `"activity"`
 *      路径字面量。判的是「结构上不可能无视迁移结果」以及「不可能只接一个」。
 *   7. 防空转：扫描文件数 < 300 ⇒ 红；`ACTIVITY_SUBDIR` / `LEGACY_ACTIVITY_DATA_REL`
 *      的声明行未命中 ⇒ 红（改名后本脚本还在扫一个不存在的符号）；测试面仍能扫到
 *      `patina/` 字面量（> 0）⇒ 否则红（有人把迁移夹具也删了，判据 1 会照样绿）。
 *
 * ## 「生产面」怎么划
 *
 * 两种排除叠加：① 路径上是测试文件（`/tests/`、`*_tests.rs`、`tests.rs`）；② 文件内
 * 第一个 `#[cfg(test)]` 之后的行。后者必须要有——本仓大量夹具住在生产文件的
 * `#[cfg(test)] mod tests` 里（`sqlite_pool/restore.rs`、`storage_migration.rs`），按目录
 * 分类会把它们当生产代码，判据 1 天天红，然后被人加白名单加废掉。
 *
 * 注释行（`//` / `///` / `//!`）一律跳过：文档里必须能写旧名字来解释这次迁移。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUST_ROOT = join(root, 'src-tauri', 'src');
const MIGRATE_MODULE = join(RUST_ROOT, 'app', 'activity_dir_migrate.rs');
const BRIDGE_MODULE = join(RUST_ROOT, 'app', 'activity_bridge.rs');
const STORAGE_PATHS = join(RUST_ROOT, 'infra', 'activity', 'storage_paths.rs');
const MIN_SCANNED_FILES = 300;

/** 旧目录名唯一允许的住所（判据 1 / 7）。 */
const LEGACY_REL_DECL = /pub const LEGACY_ACTIVITY_DATA_REL: &str = "patina\/data";/;
/** 旧库名唯一允许的住所（判据 7）：上游导入源 + 我们自己的旧名。 */
const LEGACY_DB_DECL = /pub const (UPSTREAM_DB_FILE|LEGACY_ACTIVITY_DB_FILE): &str = "patina\.db";/;
/** 新目录名的唯一真源（判据 2）。 */
const ACTIVITY_REL_DECL = /pub const ACTIVITY_DATA_REL: &str = "activity\/data";/;
/** 迁移夹具仍在练旧布局的证据：它们必须引这两个常量之一。 */
const LEGACY_FIXTURE_MARKER = /LEGACY_ACTIVITY_(DATA_REL|DB_FILE)/;

const failures = [];
const notes = [];

function fail(rule, message) {
  failures.push(`✗ 判据 ${rule}：${message}`);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 剥注释：`/* … *\/`（含 `/*!`）与 `//`（含 `///` / `//!`）。
 *
 * 必须剥：**这些文档里要写旧名字来解释这次迁移**，不剥的话判据 1/3/7 会把解释文本
 * 当成违规。代价是字符串里的 `//`（`sqlite://…`）也会被截断——那些行本来也不参与
 * 这七条判据，可以接受。
 */
function stripComments(lines) {
  const out = [];
  let inBlock = false;
  for (const text of lines) {
    let result = '';
    let index = 0;
    while (index < text.length) {
      if (inBlock) {
        const end = text.indexOf('*/', index);
        if (end < 0) {
          index = text.length;
        } else {
          inBlock = false;
          index = end + 2;
        }
        continue;
      }
      if (text.startsWith('/*', index)) {
        inBlock = true;
        index += 2;
        continue;
      }
      if (text.startsWith('//', index)) break;
      result += text[index];
      index += 1;
    }
    out.push(result);
  }
  return out;
}

function isTestPath(full) {
  const rel = relative(root, full).split(sep).join('/');
  return rel.includes('/tests/') || /(^|\/)(tests|[a-z0-9_]+_tests)\.rs$/.test(rel);
}

const sourceCache = new Map();
function sources(full) {
  if (!sourceCache.has(full)) {
    const raw = readFileSync(full, 'utf8').split('\n');
    sourceCache.set(full, { raw, stripped: stripComments(raw) });
  }
  return sourceCache.get(full);
}

/**
 * 生产面 = 文件里第一个 `#[cfg(test)]` 之前的**非注释**行。
 *
 * 为什么按 `#[cfg(test)]` 切而不是只看目录：本仓大量夹具住在生产文件的
 * `#[cfg(test)] mod tests` 里（`sqlite_pool/restore.rs`、`storage_migration.rs`），
 * 按目录分类会把它们当生产代码，判据 1 天天红，然后被人加白名单加废掉。
 */
function productionLines(full) {
  const { stripped } = sources(full);
  const out = [];
  for (let index = 0; index < stripped.length; index += 1) {
    if (stripped[index].trimStart().startsWith('#[cfg(test)]')) break;
    if (stripped[index].trim() === '') continue;
    out.push({ line: index + 1, text: stripped[index] });
  }
  return out;
}

/** 一个文件是不是测试代码：路径像测试，或者**顶层**就有 `#[test]` / `#[tokio::test]`。 */
function isTestSource(full) {
  if (isTestPath(full)) return true;
  return /^#\[(test|tokio::test)\]/m.test(readFileSync(full, 'utf8'));
}

function hits(pattern, files) {
  const found = [];
  for (const full of files) {
    for (const { line, text } of productionLines(full)) {
      if (pattern.test(text)) {
        found.push(`${relative(root, full).split(sep).join('/')}:${line}`);
      }
      pattern.lastIndex = 0;
    }
  }
  return found;
}

/** 函数体内**代码**（去注释）文，用来断言「某调用只在这里出现」。 */
function functionBody(full, name) {
  const source = sources(full).stripped.join('\n');
  const start = source.indexOf(`fn ${name}(`);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

/** 只数代码里的出现次数（注释不算）。 */
function countInCode(full, needle) {
  return productionLines(full).reduce(
    (total, { text }) => total + text.split(needle).length - 1,
    0,
  );
}

const allRust = walk(RUST_ROOT);
const production = allRust.filter((full) => !isTestSource(full));
const testFiles = allRust.filter((full) => isTestSource(full));

/* ── 判据 1：旧目录名不再作为路径片段 ───────────────────────────────── */
const legacySegment = hits(/"patina[/\\]/, production).filter((hit) => {
  const [file, line] = hit.split(':');
  return !LEGACY_REL_DECL.test(sources(join(root, file)).stripped[Number(line) - 1]);
});
const legacyJoin = hits(/join\(\s*"patina"\s*\)/, production);
const legacyDeclHits = hits(LEGACY_REL_DECL, production);
if (legacySegment.length) fail(1, `旧目录名仍作为路径片段出现在 ${legacySegment.join(', ')}`);
if (legacyJoin.length) fail(1, `仍有 join("patina")：${legacyJoin.join(', ')}`);
if (legacyDeclHits.length !== 1) {
  fail(1, `LEGACY_ACTIVITY_DATA_REL 的声明行命中 ${legacyDeclHits.length} 处（应为 1）`);
}
notes.push(`判据 1：声明行命中 ${legacyDeclHits.length} 处 / 其余路径片段 ${legacySegment.length + legacyJoin.length} 处`);

/* ── 判据 2：`*.db` 不得经 fs::copy ─────────────────────────────────── */
const migrateSource = readFileSync(MIGRATE_MODULE, 'utf8');
/* 判「**调用点**」而不是「字符串存不存在」：第一版只查 `VACUUM INTO` 出现过，于是把调用
换成 `fs::copy` 之后，那个没人用的 `vacuum_into` 函数定义里的字符串照样让判据绿着
（V-14 实测）。结构判据必须钉在「谁被调用」上。 */
const stepBody = functionBody(MIGRATE_MODULE, 'step_data');
const vacBody = functionBody(MIGRATE_MODULE, 'vacuum_into');
const copyBody = functionBody(MIGRATE_MODULE, 'copy_missing');
if (!stepBody) fail(2, '迁移模块里找不到 `step_data`');
else if (!stepBody.includes('vacuum_into(')) {
  fail(2, '`step_data` 里没有 `vacuum_into(` —— 库是怎么过去的？');
} else if (stepBody.includes('fs::copy')) {
  fail(2, '`step_data` 里出现 `fs::copy` —— 库只能经 `VACUUM INTO`（WAL 下直拷会拿到撕裂的页）');
}
if (!vacBody || !vacBody.includes('VACUUM INTO')) {
  fail(2, '`vacuum_into` 里没有 `VACUUM INTO`');
}
if (!copyBody) fail(2, '迁移模块里找不到 `copy_missing`（非库文件的复制出口）');
else if (!copyBody.includes('fs::copy')) fail(2, '`copy_missing` 里没有 `fs::copy`（备份/诊断文件怎么过去的？）');
else if (/SQLITE_DB_FILE_NAME|LEGACY_ACTIVITY_DB_FILE/.test(copyBody)) {
  fail(2, '`copy_missing` 里出现了库名 —— 库只能经 `VACUUM INTO`');
}
/* `fs::copy` 只准住在 `copy_missing` 里：多一处就说明有一条「非库文件」的路被绕开了。 */
const copyTotal = countInCode(MIGRATE_MODULE, 'fs::copy');
const copyInside = copyBody ? copyBody.split('fs::copy').length - 1 : 0;
if (copyTotal !== copyInside) {
  fail(2, `fs::copy 出现在 copy_missing 之外（共 ${copyTotal} 处，其中 ${copyInside} 处在 copy_missing）`);
}
const activityRelHits = hits(/"activity\/data"/, production).filter((hit) => {
  const [file, line] = hit.split(':');
  return !ACTIVITY_REL_DECL.test(sources(join(root, file)).stripped[Number(line) - 1]);
});
if (activityRelHits.length) fail(2, `"activity/data" 字面量跑到声明行之外：${activityRelHits.join(', ')}`);
notes.push(`判据 2：step_data 经 vacuum_into 产库；fs::copy ${copyTotal} 处全部在 copy_missing；"activity/data" 字面量在声明行之外 ${activityRelHits.length} 处`);

/* ── 判据 3：旧路径永不删 ───────────────────────────────────────────── */
const removeDirAll = countInCode(MIGRATE_MODULE, 'remove_dir_all');
const removeFile = countInCode(MIGRATE_MODULE, 'remove_file');
const partialBody = functionBody(MIGRATE_MODULE, 'discard_partial_copy');
if (removeDirAll !== 0) fail(3, `迁移模块里出现 ${removeDirAll} 处 remove_dir_all（旧路径不许删）`);
if (removeFile !== 0) {
  if (!partialBody) fail(3, `迁移模块里有 ${removeFile} 处 remove_file，但找不到 discard_partial_copy`);
  else if (partialBody.split('remove_file').length - 1 !== removeFile) {
    fail(3, '`remove_file` 出现在 `discard_partial_copy` 之外（只有半截副本可以删）');
  }
}
notes.push(`判据 3：remove_dir_all 0 处；remove_file ${removeFile} 处（全部在 discard_partial_copy 内）`);

/* ── 判据 4：结构上不可能落完成标记 ─────────────────────────────────── */
const writeCalls = countInCode(MIGRATE_MODULE, 'fs::write');
if (writeCalls !== 0) fail(4, `迁移模块里出现 ${writeCalls} 处 fs::write（不许写任何标记）`);
notes.push(`判据 4：迁移模块 fs::write ${writeCalls} 处`);

/* ── 判据 5：不许按字样改写库内数据 ─────────────────────────────────── */
const likePatina = hits(/LIKE\s+'%patina%/i, production);
/* SQL 关键字在本仓一律大写（`schema.rs:591` 的 `SELECT REPLACE(run_key, …)`），而 Rust 的
`str::replace` 是小写。不加 `i` 就是这条判据区分两者的办法——加了 `i` 就会把
`staging.replace(format!(…))` 当成 SQL。 */
const replacePatina = hits(/REPLACE\([^)]*patina/, production);
if (likePatina.length) fail(5, `出现 LIKE '%patina%'：${likePatina.join(', ')}`);
if (replacePatina.length) fail(5, `出现含 patina 的 REPLACE(：${replacePatina.join(', ')}`);
notes.push(`判据 5：LIKE '%patina%' 0 处；REPLACE 含 patina 0 处`);

/* ── 判据 6：fail-open 且两个开关都接上 ─────────────────────────────── */
const bridge = readFileSync(BRIDGE_MODULE, 'utf8');
for (const symbol of ['data_layout', 'webview_layout']) {
  if (!bridge.includes(symbol)) fail(6, `activity_bridge 里没有 ${symbol}（这个开关没接上）`);
}
if (/\.join\(\s*ACTIVITY_SUBDIR\s*\)/.test(bridge)) {
  fail(6, 'activity_bridge 里出现 `.join(ACTIVITY_SUBDIR)`（等于自己算布局，绕过了开关）');
}
const bridgeLiterals = bridge
  .split('\n')
  .map((text, index) => ({ text, line: index + 1 }))
  .filter(({ text }) => !text.trimStart().startsWith('//'))
  .filter(({ text }) => /"activity(\/|")/.test(text));
if (bridgeLiterals.length) {
  fail(6, `activity_bridge 里出现 "activity" 路径字面量：${bridgeLiterals.map((h) => h.line).join(', ')}`);
}
notes.push('判据 6：data_layout / webview_layout 均已接上，无路径字面量');

/* ── 判据 7：防空转 ─────────────────────────────────────────────────── */
const scanned = production.length;
if (scanned < MIN_SCANNED_FILES) {
  fail(7, `生产面只扫到 ${scanned} 个文件（< ${MIN_SCANNED_FILES}）——扫描根写错了？`);
}
if (!readFileSync(STORAGE_PATHS, 'utf8').includes('pub const ACTIVITY_SUBDIR: &str = "activity";')) {
  fail(7, '`ACTIVITY_SUBDIR` 的声明行没命中（改名之后本脚本在扫一个不存在的符号）');
}
/* 原设计是「测试面仍能扫到 `patina/` 字面量」。S1 之后夹具已经**全部改成引常量**
（`LEGACY_ACTIVITY_DATA_REL`），字面量归零是**正确**的结果——所以哨兵换成「测试面仍必须
引这两个旧常量之一」：它证明「有人在练旧布局」这件事没被删掉，而判据 1 才有意义。 */
const testLegacy = testFiles.filter((full) => LEGACY_FIXTURE_MARKER.test(readFileSync(full, 'utf8')));
if (testLegacy.length === 0) {
  fail(7, '测试面已经没有任何文件引用 LEGACY_ACTIVITY_*——迁移夹具被删了？判据 1 会照样绿');
}
const dbLiterals = [];
for (const full of production) {
  for (const { line, text } of productionLines(full)) {
    if (!text.includes('"patina.db"')) continue;
    if (LEGACY_DB_DECL.test(text)) continue;
    dbLiterals.push(`${relative(root, full).split(sep).join('/')}:${line}`);
  }
}
if (dbLiterals.length) {
  fail(7, `"patina.db" 字面量出现在声明行之外：${dbLiterals.join(', ')}`);
}
notes.push(`判据 7：生产面 ${scanned} 个文件；测试面 ${testLegacy.length} 个文件仍在练旧布局；"patina.db" 只在声明行`);

/* ── 收尾 ───────────────────────────────────────────────────────────── */
if (failures.length === 0) {
  console.log(`[de-patina] OK — 7 条判据全部通过（生产面 ${scanned} 个文件，测试面 ${testFiles.length} 个文件）`);
  for (const note of notes) console.log(`[de-patina] ${note}`);
  process.exit(0);
}

console.error(`[de-patina] FAILED — ${failures.length} 条判据未通过（生产面 ${scanned} 个文件）\n`);
for (const failure of failures) console.error(failure);
console.error('\n规则见 scripts/check-de-patina.mjs 头部：这一批改的是**已落盘坐标**，');
console.error('改错了不会报错，只在用户那边表现为「历史空了、应用一切正常」。');
process.exit(1);
