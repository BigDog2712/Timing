#!/usr/bin/env node
/**
 * Timing — 版本号一致性门禁（AGENTS.md：版本号同步）
 * -----------------------------------------------------------------------------
 * 桌面六处（必须同为同一 MAJOR.MINOR.PATCH）：
 *   1. package.json                      version
 *   2. package-lock.json                 version + packages[""].version
 *   3. src-tauri/Cargo.toml              [package] version
 *   4. src-tauri/Cargo.lock              name = <crate> 那条的 version
 *   5. src-tauri/tauri.conf.json         version
 * 第七处（**冻结断言**，不参与「与桌面同版本」比对）：
 *   6. scripts/archived-versions.json    → 归档工程 app/build.gradle.kts 的
 *      versionName / versionCode 必须等于冻结值（归档工程永不追当前版本）
 *
 * 为什么 crate 名要动态读（P0-4 / PRD R10）：
 *   改成 `name = "timing"` 的那一刻，若本脚本仍硬编码 `tickbar`，门禁必红，
 *   于是「改名 PR」被迫同时改门禁脚本——正是要避免的耦合。这里从
 *   `src-tauri/Cargo.toml` 的 `[package] name` 读，改名就退化为纯数据变更。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function packageJson() {
  return JSON.parse(read('package.json')).version;
}

function packageLock() {
  const lock = JSON.parse(read('package-lock.json'));
  return { top: lock.version, root: lock.packages?.['']?.version };
}

/** `[package]` 段到下一个顶层 `[` 之间，避免读到 `[lib]` 或依赖段的同名键。 */
function packageSection() {
  const src = read('src-tauri/Cargo.toml');
  const start = src.indexOf('[package]');
  if (start < 0) return '';
  const rest = src.slice(start + '[package]'.length);
  const next = rest.search(/^\[/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Rust crate 名（`[package] name`）。解析不到即 FAIL——不静默跳过。 */
function crateName() {
  const m = packageSection().match(/^name\s*=\s*"([^"]+)"/m);
  return m?.[1];
}

function cargoToml() {
  const m = packageSection().match(/^version\s*=\s*"([^"]+)"/m);
  return m?.[1];
}

function cargoLock(crate) {
  if (!crate) return undefined;
  const src = read('src-tauri/Cargo.lock');
  /* 只取本项目 crate 的 package 段：用正则**转义** crate 名，
     别指望 crate 名永远不含 `-` 之外的元字符（`-` 在正则里也只是普通字符）。 */
  const nameRe = new RegExp(`^name\\s*=\\s*"${escapeRe(crate)}"\\s*$`, 'm');
  const blocks = src.split('[[package]]');
  for (const b of blocks) {
    if (nameRe.test(b)) {
      const m = b.match(/^version\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    }
  }
  return undefined;
}

function tauriConf() {
  return JSON.parse(read('src-tauri/tauri.conf.json')).version;
}

/** 归档工程：断言冻结值未被误动（与桌面版本无关）。 */
function archivedEntries() {
  let manifest;
  try {
    manifest = JSON.parse(read('scripts/archived-versions.json'));
  } catch (err) {
    return { failures: [`scripts/archived-versions.json 读不到或不是合法 JSON：${err.message}`], rows: [] };
  }
  const failures = [];
  const rows = [];
  for (const item of manifest.archived ?? []) {
    let src;
    try {
      src = read(item.gradleFile);
    } catch {
      failures.push(`${item.id}: 找不到 ${item.gradleFile}（被删了就同步删本条目）`);
      continue;
    }
    const vn = src.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
    const vc = Number(src.match(/versionCode\s*=\s*(\d+)/)?.[1]);
    rows.push(`${item.id}: versionName=${vn ?? '（未解析到）'} versionCode=${Number.isNaN(vc) ? '（未解析到）' : vc}`);
    if (vn !== item.versionName) {
      failures.push(`${item.id}: versionName 应为冻结值 ${item.versionName}，实为 ${vn ?? '（未解析到）'}`);
    }
    if (vc !== item.versionCode) {
      failures.push(`${item.id}: versionCode 应为冻结值 ${item.versionCode}，实为 ${Number.isNaN(vc) ? '（未解析到）' : vc}`);
    }
  }
  return { failures, rows };
}

const crate = crateName();
const lock = packageLock();

const entries = [
  ['package.json', packageJson()],
  ['package-lock.json (version)', lock.top],
  ['package-lock.json (packages[""])', lock.root],
  ['src-tauri/Cargo.toml', cargoToml()],
  [`src-tauri/Cargo.lock (${crate ?? 'crate 名未解析'})`, cargoLock(crate)],
  ['src-tauri/tauri.conf.json', tauriConf()],
];

const missing = entries.filter(([, v]) => !v);
const values = new Set(entries.map(([, v]) => v).filter(Boolean));
const archive = archivedEntries();

const fail = (title, lines) => {
  console.error(`[version] FAILED — ${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
};

if (!crate) {
  /* 解析不到 crate 名时**不许**继续：`cargoLock(crate)` 会静默返回 undefined，
     下面会退化成「版本号不一致」，看不出真因是「Cargo.toml 结构变了」。 */
  fail('解析不到 crate 名', [
    'src-tauri/Cargo.toml 的 [package] 段里找不到 name = "..."。',
    '本脚本靠它定位 Cargo.lock 里的版本段；改名时必须保证该行仍存在。',
  ]);
}

if (archive.failures.length) {
  fail('归档工程版本被改动（应为冻结值）', [
    ...archive.failures,
    '',
    '归档工程 android-app/ 冻结在 0.3.6 / versionCode 9，永不追当前版本（见 android-app/ARCHIVED.md）。',
  ]);
}

if (missing.length || values.size !== 1) {
  console.error('[version] FAILED — 版本号不一致\n');
  for (const [file, v] of entries) console.error(`  ${v ? ' ' : '?'} ${file.padEnd(42)} ${v ?? '（未解析到）'}`);
  console.error('\n规则：桌面六处必须同为同一 MAJOR.MINOR.PATCH（AGENTS.md）；改版时一起改，并写 CHANGELOG.md。');
  process.exit(1);
}

const version = [...values][0];
console.log(
  `[version] OK — ${version}（桌面六处口径一致；归档冻结 ${archive.rows.join(' / ')}）`,
);
